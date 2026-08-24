#!/usr/bin/env node
/**
 * Infinite Scale Platform — Production Migration
 *
 * 1. Wipes all test data from Supabase
 * 2. Creates real agent + client auth accounts (temp pw: InfiniteScale2026!)
 * 3. Imports 488 appointments from Afspraken Log (Google Sheets)
 * 4. Uses FACTURATIE Goedgekeurd/Afgekeurd counts to correctly mark invoiced vs not
 *    - "Gefactureerd" rows → show, invoiced=true
 *    - "Te factureren" rows → split by FACTURATIE: first N=goedgekeurd invoiced, rest not
 *    - "Niet te facturere" / noshow / cancel flags → no_show / cancel
 *    - Blank date rows or future months → open
 * 5. Builds agent_clients junction table from appointment history
 *
 * Run:      node scripts/migrate.js
 * Dry run:  node scripts/migrate.js --dry-run
 */

import https from 'https';

const SB_URL       = 'https://database.infinite-scale.be';
const SERVICE_KEY  = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogInNlcnZpY2Vfcm9sZSIsICJpc3MiOiAic3VwYWJhc2UiLCAiaWF0IjogMTc4MjQ1NDUxOCwgImV4cCI6IDE5NDAxMzQ1MTh9.d7t6XFTyksADGN-ZaER4bNhc85TSn0g12FRsLGEbaU0';
const TEMP_PASSWORD = 'InfiniteScale2026!';
const SHEET_ID     = '1gB02fqBLy0VDiWokhxH9dKUWKiYMSNTq5SATAB-Jq_o';
const ADMIN_EMAIL  = 'quinten@infinite-scale.be';
const DRY_RUN      = process.argv.includes('--dry-run');

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function sbReq(method, path, body) {
  const url = new URL(SB_URL + path);
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, data: b }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sbPost = (p, b) => sbReq('POST', p, b);
const sbDel  = p => sbReq('DELETE', p);

async function authReq(method, subpath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: new URL(SB_URL).hostname,
      path: `/auth/v1/admin/${subpath}`,
      method,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, data: b }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = parseLine(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = parseLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

function parseLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && !q)  { q = true; continue; }
    if (c === '"' && q)   { if (line[i+1] === '"') { cur += '"'; i++; } else q = false; continue; }
    if (c === ',' && !q)  { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function parseDate(s) {
  if (!s) return null;
  s = s.split(' ')[0];
  const p = s.includes('/') ? s.split('/') : s.split('-');
  if (p.length !== 3) return null;
  const [d, m, y] = p;
  if (y.length === 4) return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  return null;
}

function parseDateTime(s) {
  if (!s) return null;
  const p = s.split(' ');
  const date = parseDate(p[0]);
  if (!date) return null;
  return `${date}T${p[1] || '00:00:00'}+00:00`;
}

const log  = m => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
const warn = m => console.log(`[${new Date().toISOString().slice(11,19)}] ⚠  ${m}`);

// ─── FACTURATIE data (June 2026 client invoicing) ─────────────────────────────
// Source: 💳 FACTURATIE tab → Goedgekeurd ✅ and Afgekeurd ❌ columns
// "invoiced" = "Factuur verstuurd" status in FACTURATIE
// For "Te factureren" rows: first N=goedgekeurd are show+invoiced, rest are show+not_invoiced

const JUNE_FACTURATIE = {
  // [client name]: { goedgekeurd, afgekeurd, factuurVerstuurd }
  'Bali Estate Group':         { goedgekeurd: 1,  afgekeurd: 3,  factuurVerstuurd: true  },
  'Buijsse Cars':              { goedgekeurd: 2,  afgekeurd: 2,  factuurVerstuurd: true  },
  'Cappaert Gunther':          { goedgekeurd: 6,  afgekeurd: 2,  factuurVerstuurd: true  },
  'DriveBy':                   { goedgekeurd: 0,  afgekeurd: 2,  factuurVerstuurd: false }, // geen factuur
  'EmploAI':                   { goedgekeurd: 3,  afgekeurd: 0,  factuurVerstuurd: false }, // Te factureren
  'Fiore Design':              { goedgekeurd: 1,  afgekeurd: 0,  factuurVerstuurd: true  },
  'Lumes':                     { goedgekeurd: 3,  afgekeurd: 1,  factuurVerstuurd: true  },
  'Major Green Solutions':     { goedgekeurd: 2,  afgekeurd: 1,  factuurVerstuurd: true  },
  'PixelC':                    { goedgekeurd: 18, afgekeurd: 12, factuurVerstuurd: false }, // Te factureren (overzicht verstuurd)
  'Platinum Wellness':         { goedgekeurd: 10, afgekeurd: 5,  factuurVerstuurd: true  },
  'RegenwaterInstallatie.com': { goedgekeurd: 11, afgekeurd: 1,  factuurVerstuurd: true  },
  'Renocheck':                 { goedgekeurd: 37, afgekeurd: 0,  factuurVerstuurd: true  },
  'Sccaler':                   { goedgekeurd: 11, afgekeurd: 0,  factuurVerstuurd: false }, // Te factureren
  'Sjuste':                    { goedgekeurd: 38, afgekeurd: 22, factuurVerstuurd: true  },
  'SmitFloor':                 { goedgekeurd: 5,  afgekeurd: 5,  factuurVerstuurd: false }, // Te factureren
  'Telcom':                    { goedgekeurd: 8,  afgekeurd: 4,  factuurVerstuurd: true  },
  'Views Agency':              { goedgekeurd: 3,  afgekeurd: 0,  factuurVerstuurd: false }, // Te factureren
  'DutchDandy':               { goedgekeurd: 3,  afgekeurd: 0,  factuurVerstuurd: false }, // Te factureren
};

// ─── Agents ──────────────────────────────────────────────────────────────────

const AGENTS = [
  { name: 'Senne',   email: 'senne.db@infinite-scale.be',  active: true  },
  { name: 'John',    email: 'john.vda@infinite-scale.be',   active: true  },
  { name: 'Kaius',   email: 'kaiusr@proton.me',             active: true  },
  { name: 'Bram',    email: 'sanders.bram2003@gmail.com',   active: true  },
  { name: 'Ditske',  email: 'ditske@infinite-scale.be',     active: true  },
  { name: 'Nick',    email: 'nick@infinite-scale.be',       active: true  },
  { name: 'Lotte',   email: 'lotte@infinite-scale.be',      active: true  },
  { name: 'Shalom',  email: 'shalom@infinite-scale.be',     active: true  },
  { name: 'Lothar',  email: 'lothar_dg@hotmail.com',        active: true  },
  { name: 'Mieke',   email: 'mieke@infinite-scale.be',      active: false },
  { name: 'Quinten', email: ADMIN_EMAIL, active: true, skipAuth: true },
];

// ─── Clients — name must match "Klant" in Afspraken Log exactly ──────────────

const CLIENTS = [
  // Active
  { name: 'Platinum Wellness',         email: 'michael@platinumwellness.be',     rate: 80,  agentRate: 15, status: 'active',   type: 'direct' },
  { name: 'Cappaert Gunther',          email: 'info@cappaertgunther.be',          rate: 70,  agentRate: 15, status: 'active',   type: 'direct' },
  { name: 'PixelC',                    email: 'reinhout@pixelcmedia.com',         rate: 30,  agentRate: 10, status: 'active',   type: 'direct' },
  { name: 'Views Agency',              email: 'pieter@viewsvideomarketing.be',    rate: 30,  agentRate: 10, status: 'active',   type: 'direct' },
  { name: 'Major Green Solutions',     email: 'info@majorgreensolutions.be',      rate: 70,  agentRate: 12, status: 'active',   type: 'direct' },
  { name: 'Sjuste',                    email: 'maxim@sjuste.be',                  rate: 30,  agentRate: 10, status: 'active',   type: 'direct' },
  { name: 'Sccaler',                   email: 'sccalerbusiness@gmail.com',        rate: 45,  agentRate: 15, status: 'active',   type: 'direct' },
  { name: 'RegenwaterInstallatie.com', email: 'yannig@regenwaterinstallatie.com', rate: 40,  agentRate: 10, status: 'active',   type: 'direct' },
  { name: 'Buijsse Cars',              email: 'info@buijssecars.com',             rate: 75,  agentRate: 15, status: 'active',   type: 'direct' },
  { name: 'Ravignite',                 email: 'tim@ravignite.com',                rate: 0,   agentRate: 0,  status: 'active',   type: 'direct' },
  { name: 'Bali Estate Group',         email: 'kk@baliestategroup.com',           rate: 40,  agentRate: 0,  status: 'active',   type: 'direct' },
  { name: 'DutchDandy',               email: 'info@dutchdandy.com',              rate: 15,  agentRate: 6,  status: 'active',   type: 'direct' },
  { name: 'Fiore Design',              email: 'pieter.vanroose@outlook.com',      rate: 90,  agentRate: 30, status: 'active',   type: 'direct' },
  { name: 'Lumes',                     email: 'gerrit.snel@pm.me',                rate: 110, agentRate: 30, status: 'active',   type: 'direct' },
  { name: 'Renocheck',                 email: 'maxime@renocheck.be',              rate: 14,  agentRate: 0,  status: 'active',   type: 'direct' },
  { name: 'EmploAI',                   email: 'andreas@emploai.io',               rate: 50,  agentRate: 20, status: 'active',   type: 'direct' },
  { name: 'WarmeLeads.eu',             email: 'warme@warmeleads.eu',              rate: 40,  agentRate: 15, status: 'active',   type: 'direct' },
  { name: 'Goldstone Consulting',      email: 'info@goldstoneconsulting.be',      rate: 0,   agentRate: 0,  status: 'active',   type: 'direct' },
  { name: 'Totaaladvies',              email: 'info@totaaladvies.nl',             rate: 0,   agentRate: 0,  status: 'active',   type: 'direct' },
  // Starting
  { name: 'LSM Company',               email: 'lsm@lsmcompany.be',                rate: 0,   agentRate: 0,  status: 'starting', type: 'direct' },
  { name: 'GoSellMate',                email: 'info@gosellmate.com',              rate: 0,   agentRate: 0,  status: 'starting', type: 'direct' },
  { name: 'SvN Electro',               email: 'info@svnelectro.be',               rate: 75,  agentRate: 0,  status: 'starting', type: 'direct' },
  { name: 'Batiline Group',            email: 'info@batilinegroup.be',            rate: 50,  agentRate: 10, status: 'starting', type: 'direct' },
  { name: 'SalesMatch',                email: 'info@salesmatch.be',               rate: 50,  agentRate: 20, status: 'starting', type: 'direct' },
  // Inactive (historical data)
  { name: 'SmitFloor',                 email: 'danielle@smitfloor.nl',            rate: 45,  agentRate: 10, status: 'inactive', type: 'direct' },
  { name: 'DriveBy',                   email: 'joost@driveby.be',                 rate: 110, agentRate: 15, status: 'inactive', type: 'direct' },
  { name: 'Telcom',                    email: 'liesbeth.eelen@telcom.be',         rate: 70,  agentRate: 15, status: 'inactive', type: 'direct' },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log('=== Infinite Scale Production Migration ===');
  if (DRY_RUN) log('*** DRY RUN — no writes ***\n');

  // ── 1. Wipe ───────────────────────────────────────────────────────────────
  log('Step 1: Wiping test data...');
  if (!DRY_RUN) {
    // Tables with integer/text `id` column
    const tablesWithId = ['appointments','dials','eod_reports','tickets',
                          'notifications','contracts','events','activity_log','recruits',
                          'prospects','agents','clients'];
    // Junction tables without standalone `id` — use a column that always exists
    const junctionTables = [{ t: 'agent_clients', col: 'agent_id' }];

    for (const t of tablesWithId) {
      const r = await sbDel(`/rest/v1/${t}?id=not.is.null`);
      log(`  ✓ ${t} (${r.status})`);
    }
    for (const { t, col } of junctionTables) {
      const r = await sbDel(`/rest/v1/${t}?${col}=not.is.null`);
      log(`  ✓ ${t} (${r.status})`);
    }
    // Delete all non-admin auth users
    const { data: ul } = await authReq('GET', 'users?per_page=1000');
    let deleted = 0;
    for (const u of (ul?.users || [])) {
      if (u.email === ADMIN_EMAIL) continue;
      await authReq('DELETE', `users/${u.id}`);
      deleted++;
    }
    log(`  ✓ deleted ${deleted} auth users`);
  } else {
    log('  (skipped)');
  }

  // ── 2. Admin profile_id ───────────────────────────────────────────────────
  log('\nStep 2: Admin profile_id...');
  const { data: adminList } = await authReq('GET', 'users?per_page=1000');
  const adminUser = (adminList?.users || []).find(u => u.email === ADMIN_EMAIL);
  log(`  ${adminUser ? `✓ ${adminUser.id}` : '⚠ not found'}`);

  // ── 3. Create agents ──────────────────────────────────────────────────────
  log('\nStep 3: Creating agents...');
  const agentMap = {};

  for (const [i, agent] of AGENTS.entries()) {
    let profileId = agent.skipAuth ? (adminUser?.id || null) : null;

    if (!agent.skipAuth && !DRY_RUN) {
      const r = await authReq('POST', 'users', {
        email: agent.email, password: TEMP_PASSWORD, email_confirm: true,
        user_metadata: { role: 'agent', name: agent.name, must_change_password: true },
      });
      profileId = r.data?.id;
      if (!profileId) {
        const { data: all } = await authReq('GET', 'users?per_page=1000');
        profileId = all?.users?.find(u => u.email === agent.email)?.id || null;
      }
    }

    if (!DRY_RUN) {
      const r = await sbPost('/rest/v1/agents', {
        id: `a${i + 1}`,
        profile_id: profileId, name: agent.name, email: agent.email,
        active: agent.active, status: agent.active ? 'active' : 'inactive',
        lifetime_paid: 0, working: false, feedback: [], todos: [],
      });
      if (r.status >= 400) { warn(`Agent ${agent.name}: ${JSON.stringify(r.data).slice(0,120)}`); continue; }
      const id = Array.isArray(r.data) ? r.data[0]?.id : r.data?.id;
      agentMap[agent.name.toLowerCase()] = id;
      log(`  ✓ ${agent.name} → ${id}`);
    } else {
      agentMap[agent.name.toLowerCase()] = `a-${agent.name}`;
      log(`  (dry) ${agent.name}`);
    }
  }

  // ── 4. Create clients ─────────────────────────────────────────────────────
  log('\nStep 4: Creating clients...');
  const clientMap  = {};
  const rateMap    = {};
  const seenEmails = new Set();

  for (const [ci, client] of CLIENTS.entries()) {
    const key = client.name.toLowerCase();
    let profileId = null;

    if (client.status !== 'inactive' && !seenEmails.has(client.email) && !DRY_RUN) {
      seenEmails.add(client.email);
      const r = await authReq('POST', 'users', {
        email: client.email, password: TEMP_PASSWORD, email_confirm: true,
        user_metadata: { role: 'client', name: client.name, must_change_password: true },
      });
      profileId = r.data?.id;
      if (!profileId) {
        const { data: all } = await authReq('GET', 'users?per_page=1000');
        profileId = all?.users?.find(u => u.email === client.email)?.id || null;
      }
    }

    if (!DRY_RUN) {
      const r = await sbPost('/rest/v1/clients', {
        id: `c${ci + 1}`,
        name: client.name, email: client.email, rate: client.rate,
        status: client.status, type: client.type, profile_id: profileId,
        bill_status: 'pending', subclients: [], contact_person: '', company: client.name,
      });
      if (r.status >= 400) { warn(`Client ${client.name}: ${JSON.stringify(r.data).slice(0,120)}`); continue; }
      const id = Array.isArray(r.data) ? r.data[0]?.id : r.data?.id;
      clientMap[key] = id;
      rateMap[key]   = client.rate;
      log(`  ✓ ${client.name} → ${id}`);
    } else {
      clientMap[key] = `c-${key.replace(/\W/g,'-').slice(0,14)}`;
      rateMap[key]   = client.rate;
      log(`  (dry) ${client.name}`);
    }
  }

  // ── 5. Import appointments ────────────────────────────────────────────────
  log('\nStep 5: Fetching Afspraken Log...');
  const csv  = await get(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Afspraken+Log`);
  const rows = parseCSV(csv);
  log(`  Fetched ${rows.length} rows`);

  // Per-client-per-month counter for "Te factureren" → track how many goedgekeurd we've consumed
  const teFacturerenCounter = {};  // key: `${clientName}|${yyyymm}` → count of Te factureren rows so far

  const appts = [];
  const unknownClients = new Set();
  let skipped = 0;

  for (const row of rows) {
    const leadName    = row['Naam lead']?.trim();
    const clientName  = row['Klant']?.trim();
    const agentName   = row['Agent naam']?.trim();
    const dateApptRaw = row['Datum afspraak']?.trim();
    const loggedAtRaw = row['Tijdstempel']?.trim();
    const isCancel    = row['Cancel']?.trim() === '1';
    const isNoShow    = row['No Show']?.trim() === '1';
    const statusRaw   = row['Status']?.trim();
    const invoiceRef  = row['Factuur']?.trim();

    if (!clientName) { skipped++; continue; }

    const clientKey = clientName.toLowerCase();
    const agentKey  = agentName?.toLowerCase();
    const clientId  = clientMap[clientKey];
    if (!clientId) { unknownClients.add(clientName); skipped++; continue; }

    const dateAppt = parseDate(dateApptRaw);
    const loggedAt = parseDateTime(loggedAtRaw);
    const dateLog  = loggedAt ? loggedAt.slice(0, 10) : dateAppt;
    const yyyymm   = dateAppt ? dateAppt.slice(0, 7) : null;

    let status   = 'open';
    let invoiced = false;
    let amount   = rateMap[clientKey] || 0;

    if (isCancel) {
      status = 'cancel'; amount = 0;
    } else if (isNoShow || statusRaw?.startsWith('Niet te facturere')) {
      status = 'no_show'; amount = 0;
    } else if (statusRaw === 'Gefactureerd') {
      // Already invoiced in a past month — definitely show + invoiced
      status = 'show'; invoiced = true;
    } else if (statusRaw === 'Te factureren') {
      // Appointment happened (show), but need to decide invoiced based on FACTURATIE
      status = 'show';

      if (yyyymm === '2026-06') {
        const fac = JUNE_FACTURATIE[clientName];
        if (fac) {
          const ck = `${clientName}|${yyyymm}`;
          const n  = (teFacturerenCounter[ck] || 0) + 1;
          teFacturerenCounter[ck] = n;

          if (n <= fac.goedgekeurd && fac.factuurVerstuurd) {
            invoiced = true;    // client approved + invoice sent
          } else if (n > fac.goedgekeurd) {
            amount = 0;         // afgekeurd by client — appointment happened but not billed
          }
        }
      }
      // For months before June: "Te factureren" with no "Gefactureerd" flag
      // means it was billed at the time — treat as invoiced for historical accuracy
      else if (yyyymm && yyyymm < '2026-06') {
        invoiced = true;
      }
      // July+ → open (invoiced=false, awaiting month-end)

    } else if (!statusRaw && !isCancel && !isNoShow) {
      // Blank status row — appointment in future or pending
      status = 'open'; amount = 0;
    }

    const appt = {
      agent_id:        agentMap[agentKey] || null,
      client_id:       clientId,
      sub_client_id:   null,
      lead_name:       leadName || '(onbekend)',
      phone:           '',
      date_logged:     dateLog,
      date_appt:       dateAppt,
      status,
      amount,
      invoiced,
      paid:            invoiced,
      client_feedback: invoiceRef || null,
      created_at:      loggedAt || null,
    };
    appts.push(appt);
  }

  log(`  ${appts.length} from Afspraken Log, ${skipped} skipped`);
  if (unknownClients.size) warn(`Unknown clients: ${[...unknownClients].join(', ')}`);

  // ── 5b. Renocheck afspraken (separate sheet, different format) ────────────
  log('\nStep 5b: Fetching Renocheck afspraken...');
  const renoCsv  = await get(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Renocheck+afspraken`);
  const renoRows = parseCSV(renoCsv);
  const renoClientId = clientMap['renocheck'];

  if (!renoClientId) {
    warn('Renocheck not in clientMap — skipping Renocheck sheet');
  } else {
    for (const row of renoRows) {
      const ts       = row['Tijdstempel']?.trim();
      const agentName = row['Agent naam']?.trim();
      const leadName  = row['Naam lead']?.trim();
      const leadType  = row['Type lead']?.trim();
      const categorie = row['Categorie']?.trim();
      if (!ts) continue;

      // Parse date from "dd-m-yyyy HH:MM:SS"
      const tsParts = ts.split(' ');
      const dateParts = tsParts[0].split('-');
      if (dateParts.length !== 3) continue;
      const [d, m, y] = dateParts;
      const dateStr = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
      const yyyymm  = dateStr.slice(0, 7);
      const loggedAt = `${dateStr}T${tsParts[1] || '00:00:00'}+00:00`;

      const agentKey = agentName?.toLowerCase();
      const isJune   = yyyymm === '2026-06';

      appts.push({
        agent_id:        agentMap[agentKey] || null,
        client_id:       renoClientId,
        sub_client_id:   null,
        lead_name:       leadName || '(onbekend)',
        phone:           '',
        date_logged:     dateStr,
        date_appt:       dateStr,
        status:          isJune ? 'show' : 'open',
        amount:          isJune ? 14 : 0,   // €14/lead for June (all 37 goedgekeurd)
        invoiced:        isJune,             // all June Renocheck → Factuur verstuurd
        paid:            isJune,
        client_feedback: categorie || null,
        created_at:      loggedAt,
      });
    }
    const renoJune = appts.filter(a => a.client_id === renoClientId && a.invoiced).length;
    const renoJuly = appts.filter(a => a.client_id === renoClientId && !a.invoiced).length;
    log(`  ✓ ${renoJune} June (invoiced) + ${renoJuly} July (open) Renocheck appointments`);
  }

  // ── Insert all appointments ───────────────────────────────────────────────
  if (DRY_RUN) {
    const byStatus = {};
    for (const a of appts) byStatus[a.status] = (byStatus[a.status]||0)+1;
    log('\n  Final status breakdown:');
    console.log(' ', byStatus);
    log(`  Invoiced: ${appts.filter(a=>a.invoiced).length}`);
    log(`  Total invoiced amount: €${appts.filter(a=>a.invoiced).reduce((s,a)=>s+a.amount,0)}`);
    log('\n  June "Te factureren" counters (Afspraken Log):');
    for (const [k,n] of Object.entries(teFacturerenCounter)) {
      const [client, month] = k.split('|');
      const fac = JUNE_FACTURATIE[client];
      log(`    ${client}: ${n} rows, ${fac?.goedgekeurd} goedgekeurd, ${fac?.afgekeurd} afgekeurd`);
    }
    log('\n  Sample (first show+invoiced):');
    console.log(JSON.stringify(appts.find(a=>a.status==='show'&&a.invoiced), null, 2));
  } else {
    let inserted = 0;
    for (let i = 0; i < appts.length; i += 50) {
      const batch = appts.slice(i, i + 50).map((a, j) => ({ id: `ap${i + j + 1}`, ...a }));
      const r = await sbPost('/rest/v1/appointments', batch);
      if (r.status >= 400) warn(`Batch ${i}: ${JSON.stringify(r.data).slice(0,200)}`);
      else inserted += batch.length;
    }
    log(`  ✓ ${inserted} total appointments inserted`);
  }

  // ── 6. agent_clients junction ─────────────────────────────────────────────
  log('\nStep 6: Building agent-client links...');
  const pairs = new Map();
  for (const a of appts) {
    if (!a.agent_id || !a.client_id) continue;
    const k = `${a.agent_id}:${a.client_id}`;
    if (!pairs.has(k)) pairs.set(k, { agent_id: a.agent_id, client_id: a.client_id });
  }
  const junctionRows = [...pairs.values()].map(({ agent_id, client_id }) => {
    const cl = CLIENTS.find(c => clientMap[c.name.toLowerCase()] === client_id);
    return { agent_id, client_id, rate: cl?.agentRate ?? 0 };
  });

  if (!DRY_RUN && junctionRows.length > 0) {
    const r = await sbPost('/rest/v1/agent_clients', junctionRows);
    if (r.status >= 400) warn(`agent_clients: ${JSON.stringify(r.data).slice(0,200)}`);
    else log(`  ✓ ${junctionRows.length} links`);
  } else {
    log(`  ${junctionRows.length} pairs${DRY_RUN ? ' (dry)' : ''}`);
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  log('\n=== Done ===');
  log(`Agents: ${Object.keys(agentMap).length}  Clients: ${Object.keys(clientMap).length}  Appointments: ${appts.length}  Links: ${junctionRows.length}`);
  if (!DRY_RUN) log(`\nTemp password: ${TEMP_PASSWORD}`);
}

main().catch(e => { console.error(e); process.exit(1); });
