// Dual-purpose: enhance-contract (contract AI suggestions) + claude-task (Platform todo SSE streaming)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const body = req.body || {};

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
