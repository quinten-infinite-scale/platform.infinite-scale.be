// Triple-purpose: enhance-contract + claude-task (Platform todo SSE) + closer-analysis (CLOSER framework scoring)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

Geef ALLEEN geldig JSON terug zonder markdown:
{"c":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":7},"l":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":6},"o":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":5},"s":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":7},"e":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":6},"r":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":8},"biggest_growth_point":"...","score_total":6.5,"deal_facts":{"prospect":"...","pricing":"...","terms":"...","next_steps":"..."}}

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
