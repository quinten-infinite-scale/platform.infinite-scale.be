// Quad-purpose: save-contract + enhance-contract + claude-task (SSE) + closer-analysis

const SB_URL_SC = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const RESEND_KEY_SC = () => process.env.RESEND_API_KEY;

async function handleSaveContract(req, res) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Service key not configured' });

  if (req.body?.action === 'onboard-after-sign') {
    const { sign_token, email, name, party_type } = req.body || {};
    if (!sign_token || !email) return res.status(400).json({ error: 'sign_token and email required' });
    const sbH = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

    const contractR = await fetch(`${SB_URL_SC}/rest/v1/contracts?id=eq.${encodeURIComponent(sign_token)}&select=id,party,party_type,email,type,value,contract_html&limit=1`, { headers: sbH });
    const contracts = await contractR.json();
    const contract = contracts?.[0];
    if (!contract) return res.status(403).json({ error: 'Invalid sign token' });
    const resolvedEmail = (email || contract.email || '').trim().toLowerCase();
    const resolvedName  = name || contract.party || resolvedEmail.split('@')[0];
    const resolvedPartyType = party_type || contract.party_type || 'client';

    const ensureAuthUser = async (role) => {
      let uid;
      const cR = await fetch(`${SB_URL_SC}/auth/v1/admin/users`, { method: 'POST', headers: sbH, body: JSON.stringify({ email: resolvedEmail, email_confirm: true }) });
      const cD = await cR.json();
      if (cR.ok && cD.id) { uid = cD.id; } else {
        const lR = await fetch(`${SB_URL_SC}/auth/v1/admin/users?email=${encodeURIComponent(resolvedEmail)}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
        const lD = await lR.json();
        uid = lD?.users?.[0]?.id;
        if (!uid) throw new Error('Could not create or find auth user for ' + resolvedEmail);
      }
      await fetch(`${SB_URL_SC}/rest/v1/profiles`, { method: 'POST', headers: { ...sbH, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: uid, name: resolvedName, email: resolvedEmail, role }) });
      return uid;
    };

    const genSetupUrl = async () => {
      const lR = await fetch(`${SB_URL_SC}/auth/v1/admin/generate_link`, { method: 'POST', headers: sbH, body: JSON.stringify({ type: 'recovery', email: resolvedEmail }) });
      if (!lR.ok) return null;
      const lD = await lR.json();
      return lD.hashed_token ? `https://platform.infinite-scale.be/api/create-account?action=auth-redirect&token=${encodeURIComponent(lD.hashed_token)}&type=recovery&new=1` : null;
    };

    const sendOnboardEmail = async (setupUrl, isAgent) => {
      const rKey = RESEND_KEY_SC();
      if (!rKey || rKey === 're_placeholder') return { emailSent: false, warn: 'RESEND_API_KEY not configured' };
      const greeting = `Contract getekend — welkom, ${resolvedName}!`;
      const intro1 = isAgent ? 'Je contract is succesvol ondertekend. Je agent account op het Infinite Scale platform is aangemaakt.' : 'Uw contract is succesvol ondertekend. Uw account op het Infinite Scale platform is aangemaakt.';
      const intro2 = isAgent ? 'Klik op de knop hieronder om je wachtwoord in te stellen en direct in te loggen als callagent.' : 'Klik op de knop hieronder om uw wachtwoord in te stellen en direct in te loggen.';
      const html = `<div style="background:#0a0e1a;padding:0;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:540px;margin:0 auto;padding:40px 24px;"><div style="margin-bottom:32px;"><span style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#4ade80;font-weight:700;">Infinite Scale</span></div><h1 style="margin:0 0 12px;font-size:28px;font-weight:700;color:#f0f4ff;letter-spacing:-.02em;line-height:1.15;">${greeting}</h1><p style="margin:0 0 8px;font-size:15px;color:#8090b0;line-height:1.7;">${intro1}</p><p style="margin:0 0 32px;font-size:15px;color:#8090b0;line-height:1.7;">${intro2}</p><a href="${setupUrl}" style="display:inline-block;padding:15px 36px;border-radius:12px;background:#4ade80;color:#071407;font-weight:800;font-size:15px;text-decoration:none;letter-spacing:-.01em;">Wachtwoord instellen →</a><div style="margin-top:36px;padding:18px 20px;border-radius:12px;background:#111827;border:1px solid #1f2d3d;"><p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#4a5a7a;letter-spacing:.08em;text-transform:uppercase;">Inloggegevens</p><p style="margin:0 0 4px;font-size:13px;color:#a0b0d0;">Platform: <a href="https://platform.infinite-scale.be" style="color:#4ade80;text-decoration:none;">platform.infinite-scale.be</a></p><p style="margin:0;font-size:13px;color:#a0b0d0;">E-mail: <strong style="color:#f0f4ff;">${resolvedEmail}</strong></p></div><p style="margin-top:32px;font-size:12px;color:#2d3d55;line-height:1.6;">Deze link is 24 uur geldig. Vragen? Mail naar <a href="mailto:quinten@infinite-scale.be" style="color:#3d5070;text-decoration:none;">quinten@infinite-scale.be</a></p></div></div>`;
      try {
        const er = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${rKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Infinite Scale <platform@infinite-scale.be>', to: [resolvedEmail], subject: 'Contract getekend — stel je wachtwoord in bij Infinite Scale', html }) });
        const ed = await er.json();
        return er.ok ? { emailSent: true } : { emailSent: false, emailError: ed?.message };
      } catch (e) { return { emailSent: false, emailError: e.message }; }
    };

    try {
      if (resolvedPartyType === 'client') {
        // Extract rate and setup fee from contract (used for both new and existing clients)
        let contractRate = contract.value ? Math.round(parseFloat(contract.value)) : 0;
        let contractSetupFee = 0;
        if (contract.contract_html) {
          const text = contract.contract_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
          const rateMatch = text.match(/(?:per\s+(?:gehouden\s+)?afspraak)[^€]*€\s*([\d.,]+)/i) || text.match(/€\s*([\d.,]+)[^€\n]{0,60}(?:per\s+(?:gehouden\s+)?afspraak)/i);
          if (rateMatch) contractRate = Math.round(parseFloat(rateMatch[1].replace(/\./g, '').replace(',', '.')));
          const setupMatch = text.match(/[Oo]pstartkost[^€]*€\s*([\d.,]+)/i);
          if (setupMatch) contractSetupFee = Math.round(parseFloat(setupMatch[1].replace(/\./g, '').replace(',', '.')));
        }
        if (!contractRate) contractRate = 45;

        let clientId;
        const existingR = await fetch(`${SB_URL_SC}/rest/v1/clients?email=eq.${encodeURIComponent(resolvedEmail)}&select=id&limit=1`, { headers: sbH });
        const existing = await existingR.json();
        if (existing?.[0]?.id) { clientId = existing[0].id; } else {
          const allClR = await fetch(`${SB_URL_SC}/rest/v1/clients?select=id`, { headers: sbH });
          const allCl = await allClR.json();
          const maxNum = (allCl || []).reduce((m, c) => { const n = parseInt((c.id || '').replace(/\D/g, ''), 10); return isNaN(n) ? m : Math.max(m, n); }, 0);
          const newClientId = 'c' + (maxNum + 1);
          const today = new Date().toISOString().slice(0, 10);
          const newClientR = await fetch(`${SB_URL_SC}/rest/v1/clients`, { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify({ id: newClientId, name: resolvedName, email: resolvedEmail, type: 'direct', status: 'starting', crm: 'none', crm_on: false, kickoff: today, rate: contractRate, setup_fee: contractSetupFee || null, contact_person: resolvedName, company: resolvedName, bill_status: 'pending', subclients: [] }) });
          const newCl = await newClientR.json();
          clientId = newCl?.[0]?.id || newClientId;
        }
        const userId = await ensureAuthUser('client');
        // Always sync rate, setup_fee, and contact info from the signed contract onto the client record
        const clientSync = { profile_id: userId, email: resolvedEmail, rate: contractRate };
        if (contractSetupFee) clientSync.setup_fee = contractSetupFee;
        if (contract.vat) clientSync.vat = contract.vat;
        if (contract.contact) clientSync.contact_person = contract.contact;
        if (contract.address) clientSync.address = contract.address;
        await fetch(`${SB_URL_SC}/rest/v1/clients?id=eq.${clientId}`, { method: 'PATCH', headers: { ...sbH, Prefer: 'return=minimal' }, body: JSON.stringify(clientSync) });
        const setupUrl = await genSetupUrl();
        if (!setupUrl) return res.status(500).json({ error: 'Failed to generate setup link', userId, clientId });
        const emailResult = await sendOnboardEmail(setupUrl, false);
        return res.status(200).json({ ok: true, userId, clientId, ...emailResult });
      }
      if (resolvedPartyType === 'agent') {
        let agentId;
        const agLookupR = await fetch(`${SB_URL_SC}/rest/v1/agents?email=eq.${encodeURIComponent(resolvedEmail)}&select=id&limit=1`, { headers: sbH });
        const agLookup = await agLookupR.json();
        if (agLookup?.[0]?.id) { agentId = agLookup[0].id; } else {
          const allAgR = await fetch(`${SB_URL_SC}/rest/v1/agents?select=id`, { headers: sbH });
          const allAg = await allAgR.json();
          const maxNum = (allAg || []).reduce((m, a) => { const n = parseInt((a.id || '').replace(/\D/g, ''), 10); return isNaN(n) ? m : Math.max(m, n); }, 0);
          agentId = 'a' + (maxNum + 1);
          await fetch(`${SB_URL_SC}/rest/v1/agents`, { method: 'POST', headers: { ...sbH, Prefer: 'return=minimal' }, body: JSON.stringify({ id: agentId, name: resolvedName, email: resolvedEmail, active: true, status: 'signed', working: false, feedback: [], todos: [], lifetime_paid: 0 }) });
        }
        const userId = await ensureAuthUser('agent');
        await fetch(`${SB_URL_SC}/rest/v1/agents?id=eq.${agentId}`, { method: 'PATCH', headers: { ...sbH, Prefer: 'return=minimal' }, body: JSON.stringify({ profile_id: userId, email: resolvedEmail }) });
        const setupUrl = await genSetupUrl();
        if (!setupUrl) return res.status(500).json({ error: 'Failed to generate setup link', userId, agentId });
        const emailResult = await sendOnboardEmail(setupUrl, true);
        return res.status(200).json({ ok: true, userId, agentId, ...emailResult });
      }
      return res.status(200).json({ ok: true, skipped: true, reason: 'unknown party_type: ' + resolvedPartyType });
    } catch (err) {
      console.error('[onboard-after-sign] error:', err);
      return res.status(500).json({ error: err.message || 'Internal error during onboarding' });
    }
  }

  const raw = req.body;
  if (!raw || !raw.id) return res.status(400).json({ error: 'Missing required field: id' });

  const KNOWN = ['id','party','party_type','type','status','sent','value','email','vat','address','contact','duration','notes','setup_fee','signing_link','sign_token','signed_at','signer_name','signature_image','contract_html'];
  const contract = Object.fromEntries(Object.entries(raw).filter(([k]) => KNOWN.includes(k)));
  if (contract.party_type === 'addendum') contract.party_type = 'agent';

  const r = await fetch('https://database.infinite-scale.be/rest/v1/contracts', {
    method: 'POST',
    headers: { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(contract),
  });
  if (!r.ok) { const err = await r.text(); return res.status(r.status).json({ error: err }); }
  return res.status(201).json({ ok: true });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Route save-contract calls (via rewrite from /api/save-contract)
  if (req.query?.route === 'save') return handleSaveContract(req, res);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const body = req.body || {};

  // ── CLOSER Analysis ────────────────────────────────────────────────────────
  if (body.transcript && !body.ctype && !body.title) {
    const { transcript } = body;
    const closerPrompt = `Je bent een sales coach die verkoopgesprekken analyseert met het CLOSER-framework van Alex Hormozi.

Analyseer het volgende transcript en geef een gedetailleerde analyse in het Nederlands (Vlaams).

CLOSER FRAMEWORK:
C - Clarify: Werd de reden van het gesprek helder gesteld? Werden de doelen van de prospect verduidelijkt?
L - Label: Werd het probleem van de prospect gelabeld/benoemd? Voelde de prospect zich begrepen?
O - Overview/Consequence: Werden de gevolgen van niet-handelen duidelijk gemaakt? Werd urgentie gecreeerd?
S - Sell the vacation: Werd de gewenste toekomststaat verkocht (niet het product)? Werd de droom van de prospect aangesproken?
E - Explain away objections: Werden bezwaren proactief weggenomen? Werd de methode van consequence-selling gebruikt?
R - Reinforce: Werd de beslissing van de prospect versterkt? Werden next steps duidelijk afgesproken?

Voor elke sectie geef: wat_er_gebeurde, wat_beter_kon, score /10.
Wees direct en kritisch.

Eindig met: biggest_growth_point (1 zin), score_total (gemiddelde), deal_facts: {prospect, pricing, terms, next_steps}.

Identificeer ook de volgende concrete actie op basis van het transcript:
- next_action_type: één van "second_call", "follow_up_call", "send_info", "meeting", "herplan_call", "geen_actie", "niet_gekwalificeerd"
- next_action_date: datum indien vermeld in het gesprek (formaat YYYY-MM-DD), anders null
- next_action_notes: korte beschrijving van wat er precies moet gebeuren (max 1 zin)

Geef ALLEEN geldig JSON terug zonder markdown:
{"c":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":7},"l":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":6},"o":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":5},"s":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":7},"e":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":6},"r":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":8},"biggest_growth_point":"...","score_total":6.5,"deal_facts":{"prospect":"...","pricing":"...","terms":"...","next_steps":"..."},"next_action_type":"second_call","next_action_date":null,"next_action_notes":"..."}

TRANSCRIPT:
${transcript}`;

    try {
      const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4096, messages: [{ role: 'user', content: closerPrompt }] }),
      });
      const aiData = await aiResp.json();
      if (!aiResp.ok) return res.status(aiResp.status).json({ error: aiData });
      const raw = (aiData.content && aiData.content[0] && aiData.content[0].text) || '';
      let analysis = {};
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
          // Claude sometimes returns literal newlines inside string values; sanitize before parsing
          const cleaned = m[0].replace(/[\x00-\x1F\x7F]/g, c => c === '\n' || c === '\r' || c === '\t' ? ' ' : '');
          analysis = JSON.parse(cleaned);
        }
      } catch (_) { analysis = { error: 'parse_failed', raw: raw.slice(0, 500) }; }
      return res.status(200).json({ ok: true, analysis });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Claude Task (Platform todo streaming) ──────────────────────────────────
  if (body.title && !body.ctype) {
    const { title, notes } = body;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const prompt = `You are a senior full-stack developer and product specialist for Infinite Scale — a Belgian appointment-setting operations platform. The platform is built with a custom DCLogic framework (React-like, no JSX), Supabase as backend, and deployed on Vercel.

Your job is to execute this platform task:

**${title}**${notes ? `\n\nContext/notes:\n${notes}` : ''}

Provide:
1. A clear analysis of what this task involves
2. A step-by-step action plan with specific implementation details
3. Any code, SQL, configuration, or copy that needs to be written
4. Potential blockers or dependencies to be aware of

Be thorough, specific, and immediately actionable. Write as if you are about to implement this yourself.`;

    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          stream: true,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!upstream.ok) {
        const err = await upstream.text();
        res.write(`data: ${JSON.stringify({ error: err })}\n\n`);
        return res.end();
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const ev = JSON.parse(raw);
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
              res.write(`data: ${JSON.stringify({ text: ev.delta.text })}\n\n`);
            }
          } catch (_) {}
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
      return res.end();
    }
  }

  // ── Enhance Contract (contract AI suggestions) ────────────────────────────
  const { ctype, party, rate, setupFee, duration, paymentTerm, notes, isAgent } = body;

  const prompt = `Je bent een juridisch assistent voor Infinite Scale, een Belgisch appointment-setting bureau.
Je krijgt contractgegevens en moet kleine, gerichte aanpassingen voorstellen aan een standaard Nederlandstalig dienstverleningscontract.
Pas ALLEEN aan wat relevant is op basis van de input. Geef beknopte tekst — dit zijn toevoegingen aan bestaande artikelen, geen volledige herschrijvingen.

Contractgegevens:
- Type: ${ctype || '—'}
- Partij: ${party || '—'}
- Tarief: ${rate ? '€' + rate + '/afspraak' : '—'}
${setupFee ? '- Opstartvergoeding: €' + setupFee : ''}
- Looptijd: ${duration || '—'}
- Betaaltermijn: ${paymentTerm || 14} kalenderdagen
- Bijzondere notities: ${notes || '—'}
- Agentcontract: ${isAgent ? 'ja' : 'nee'}

Geef een JSON-object terug met EXACTE velden (geen markdown, enkel raw JSON):
{
  "scopeAddition": "Optionele extra zin voor artikel 1 (Voorwerp) op basis van specifieke diensten of afspraken. Laat leeg string als niet relevant.",
  "specialConditions": "Optionele bijzondere voorwaarden gebaseerd op de notities. Laat leeg string als de notities al duidelijk zijn of er geen zijn.",
  "durationNote": "Optionele aanvulling op de looptijd/opzegtermijn als er iets speciaals is. Laat leeg string als standaard."
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: err });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    return res.status(200).json({
      scopeAddition: parsed.scopeAddition || '',
      specialConditions: parsed.specialConditions || '',
      durationNote: parsed.durationNote || '',
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
