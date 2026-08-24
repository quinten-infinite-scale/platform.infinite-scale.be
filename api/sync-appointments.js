/**
 * Google Sheet → Supabase appointment sync
 *
 * Pulls today's rows (or a specific date) from the Afspraken Log sheet
 * and upserts them into the appointments table without touching existing data.
 *
 * Safe to call multiple times — uses upsert on appointment id.
 *
 * POST /api/sync-appointments                → syncs today's new rows
 * POST /api/sync-appointments?date=YYYY-MM-DD → syncs a specific date
 * POST /api/sync-appointments?full=true       → re-syncs all rows (careful)
 */

const SB_URL   = 'https://database.infinite-scale.be';
const SHEET_ID = '1gB02fqBLy0VDiWokhxH9dKUWKiYMSNTq5SATAB-Jq_o';

// FACTURATIE data for June 2026 — same as migrate.js
const JUNE_FACTURATIE = {
  'Bali Estate Group':         { goedgekeurd: 1,  afgekeurd: 3,  factuurVerstuurd: true  },
  'Buijsse Cars':              { goedgekeurd: 2,  afgekeurd: 2,  factuurVerstuurd: true  },
  'Cappaert Gunther':          { goedgekeurd: 6,  afgekeurd: 2,  factuurVerstuurd: true  },
  'DriveBy':                   { goedgekeurd: 0,  afgekeurd: 2,  factuurVerstuurd: false },
  'EmploAI':                   { goedgekeurd: 3,  afgekeurd: 0,  factuurVerstuurd: false },
  'Fiore Design':              { goedgekeurd: 1,  afgekeurd: 0,  factuurVerstuurd: true  },
  'Lumes':                     { goedgekeurd: 3,  afgekeurd: 1,  factuurVerstuurd: true  },
  'Major Green Solutions':     { goedgekeurd: 2,  afgekeurd: 1,  factuurVerstuurd: true  },
  'PixelC':                    { goedgekeurd: 18, afgekeurd: 12, factuurVerstuurd: false },
  'Platinum Wellness':         { goedgekeurd: 10, afgekeurd: 5,  factuurVerstuurd: true  },
  'RegenwaterInstallatie.com': { goedgekeurd: 11, afgekeurd: 1,  factuurVerstuurd: true  },
  'Renocheck':                 { goedgekeurd: 37, afgekeurd: 0,  factuurVerstuurd: true  },
  'Sccaler':                   { goedgekeurd: 11, afgekeurd: 0,  factuurVerstuurd: false },
  'Sjuste':                    { goedgekeurd: 38, afgekeurd: 22, factuurVerstuurd: true  },
  'SmitFloor':                 { goedgekeurd: 5,  afgekeurd: 5,  factuurVerstuurd: false },
  'Telcom':                    { goedgekeurd: 8,  afgekeurd: 4,  factuurVerstuurd: true  },
  'Views Agency':              { goedgekeurd: 3,  afgekeurd: 0,  factuurVerstuurd: false },
  'DutchDandy':                { goedgekeurd: 3,  afgekeurd: 0,  factuurVerstuurd: false },
};

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = parseLine(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = parseLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

function parseLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && !q) { q = true; continue; }
    if (c === '"' && q)  { if (line[i+1] === '"') { cur += '"'; i++; } else q = false; continue; }
    if (c === ',' && !q) { out.push(cur.trim()); cur = ''; continue; }
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

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const auth = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  const today    = new Date().toISOString().slice(0, 10);
  const filterDate = req.query.date || today;
  const fullSync   = req.query.full === 'true';

  // ── Load current agents + clients maps from Supabase ──────────────────────
  const [agentsRes, clientsRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/agents?select=id,name,email`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
    }),
    fetch(`${SB_URL}/rest/v1/clients?select=id,name,rate,subclients`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
    }),
  ]);

  const agents  = await agentsRes.json();
  const clients = await clientsRes.json();

  // Lowercase name → id
  const agentMap  = Object.fromEntries((agents  || []).map(a => [a.name.toLowerCase(),  a.id]));
  const clientMap = Object.fromEntries((clients || []).map(c => [c.name.toLowerCase(),  c.id]));
  const rateMap   = Object.fromEntries((clients || []).map(c => [c.name.toLowerCase(),  c.rate || 0]));

  // Build sub_client map: "ClientName: SubClientName" (lowercase) → sub_client_id
  const subClientMap = {};
  for (const c of (clients || [])) {
    for (const sc of (c.subclients || [])) {
      const key = `${c.name.toLowerCase()}: ${sc.name.toLowerCase()}`;
      subClientMap[key] = sc.id;
      // Also without client prefix (e.g. bare "Bol University")
      subClientMap[sc.name.toLowerCase()] = sc.id;
    }
  }

  // ── Fetch existing appointment IDs to avoid counting duplicates ────────────
  const existingRes = await fetch(
    `${SB_URL}/rest/v1/appointments?select=id&order=id.desc&limit=2000`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } },
  );
  const existingRows = await existingRes.json();
  // IDs are like "ap1", "ap2" — find max number to continue from
  let maxApId = 0;
  for (const r of (existingRows || [])) {
    const n = parseInt((r.id || '').replace('ap', ''), 10);
    if (!isNaN(n) && n > maxApId) maxApId = n;
  }

  // ── Fetch sheet ────────────────────────────────────────────────────────────
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Afspraken+Log`;
  const csvRes = await fetch(csvUrl);
  if (!csvRes.ok) return res.status(500).json({ error: 'Could not fetch Google Sheet' });
  const rows = parseCSV(await csvRes.text());

  // Also fetch Renocheck sheet
  const renoCsvRes = await fetch(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Renocheck+afspraken`,
  );
  const renoRows = renoCsvRes.ok ? parseCSV(await renoCsvRes.text()) : [];

  // ── Build appointment objects ──────────────────────────────────────────────
  const teFacturerenCounter = {};
  const newAppts = [];
  let apIdCounter = maxApId;

  const processRow = (row, isReno = false) => {
    const loggedAtRaw = row['Tijdstempel']?.trim();
    const loggedAt    = parseDateTime(loggedAtRaw);
    const loggedDate  = loggedAt ? loggedAt.slice(0, 10) : null;

    // Filter: only rows logged on filterDate (unless full sync)
    if (!fullSync && loggedDate !== filterDate) return;

    let clientName, agentName, dateApptRaw, leadName, invoiceRef;
    let status = 'open', invoiced = false, amount = 0;

    if (isReno) {
      agentName   = row['Agent naam']?.trim();
      leadName    = row['Naam lead']?.trim();
      const categorie = row['Categorie']?.trim();
      dateApptRaw = loggedAtRaw; // Renocheck: logged date = appt date
      clientName  = 'Renocheck';
      invoiceRef  = categorie || null;
      const yyyymm = loggedDate ? loggedDate.slice(0, 7) : null;
      if (yyyymm === '2026-06') { status = 'show'; invoiced = true; amount = 14; }
      else { status = 'open'; }
    } else {
      leadName    = row['Naam lead']?.trim();
      clientName  = row['Klant']?.trim();
      agentName   = row['Agent naam']?.trim();
      dateApptRaw = row['Datum afspraak']?.trim();
      invoiceRef  = row['Factuur']?.trim();
      const leadAgency = row['Klant leadgency']?.trim();
      const isCancel = row['Cancel']?.trim() === '1';
      const isNoShow = row['No Show']?.trim() === '1';
      const statusRaw = row['Status']?.trim();
      const dateAppt  = parseDate(dateApptRaw);
      const yyyymm    = dateAppt ? dateAppt.slice(0, 7) : null;

      if (isCancel) {
        status = 'cancel'; amount = 0;
      } else if (isNoShow || statusRaw?.startsWith('Niet te facturere')) {
        status = 'no_show'; amount = 0;
      } else if (statusRaw === 'Gefactureerd') {
        status = 'show'; invoiced = true; amount = rateMap[clientName?.toLowerCase()] || 0;
      } else if (statusRaw === 'Te factureren') {
        status = 'show';
        amount = rateMap[clientName?.toLowerCase()] || 0;
        if (yyyymm === '2026-06') {
          const fac = JUNE_FACTURATIE[clientName];
          if (fac) {
            const ck = `${clientName}|${yyyymm}`;
            const n  = (teFacturerenCounter[ck] || 0) + 1;
            teFacturerenCounter[ck] = n;
            if (n <= fac.goedgekeurd && fac.factuurVerstuurd) invoiced = true;
            else if (n > fac.goedgekeurd) amount = 0;
          }
        } else if (yyyymm && yyyymm < '2026-06') {
          invoiced = true;
        }
      } else {
        status = 'open'; amount = 0;
      }
    }

    if (!clientName) return;
    const clientKey = clientName.toLowerCase();
    const agentKey  = agentName?.toLowerCase();
    const clientId  = clientMap[clientKey];
    if (!clientId) return; // unknown client

    const dateAppt  = parseDate(dateApptRaw);
    const dateLog   = loggedDate || dateAppt;

    apIdCounter++;
    newAppts.push({
      id:              `ap${apIdCounter}`,
      agent_id:        agentMap[agentKey] || null,
      client_id:       clientId,
      sub_client_id:   (leadAgency ? (subClientMap[leadAgency.toLowerCase()] || null) : null),
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
    });
  };

  for (const row of rows)     processRow(row, false);
  for (const row of renoRows) processRow(row, true);

  if (newAppts.length === 0) {
    return res.status(200).json({
      synced: 0,
      date: filterDate,
      note: fullSync ? 'No rows to sync' : `No new appointments logged on ${filterDate} in the sheet`,
    });
  }

  // ── Upsert into Supabase (on conflict id → update) ─────────────────────────
  // Send in batches of 50
  let inserted = 0;
  const errors = [];
  for (let i = 0; i < newAppts.length; i += 50) {
    const batch = newAppts.slice(i, i + 50);
    const r = await fetch(`${SB_URL}/rest/v1/appointments?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (r.ok) inserted += batch.length;
    else errors.push(await r.text());
  }

  console.log(`[sync-appointments] ${inserted} upserted for ${filterDate}`);
  return res.status(200).json({
    synced: inserted,
    date: filterDate,
    ...(errors.length ? { errors } : {}),
  });
}
