// Vercel cron: runs daily at 09:00 UTC
// Fires on exactly 3 days per month:
//   1. The 25th        → first reminder
//   2. 2 days before month-end → urgent reminder
//   3. Last day of month → final "we invoice everything" warning
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const today = now.getDate();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = lastDay - today; // 0 = last day, 2 = 2 days before end

  // Determine which trigger applies today
  let trigger = null;
  if (today === 25) trigger = 'first';
  else if (daysLeft === 2) trigger = 'second';
  else if (daysLeft === 0) trigger = 'last';

  if (!trigger) {
    return res.status(200).json({ skipped: true, reason: `Day ${today}, daysLeft ${daysLeft} — not a trigger day` });
  }

  const SB_URL = 'https://database.infinite-scale.be';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Service key not configured' });

  const currentYM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const monthEnd = `${currentYM}-${String(lastDay).padStart(2, '0')}`;
  const monthLabel = now.toLocaleString('nl-BE', { month: 'long', year: 'numeric' });
  const deadlineStr = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
  const nextMonthStr = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    .toLocaleString('nl-BE', { month: 'long' });

  // Only fetch appointments still in 'open' status — clients who've reviewed all theirs get no reminder
  const apptRes = await fetch(
    `${SB_URL}/rest/v1/appointments?date_appt=gte.${currentYM}-01&date_appt=lte.${monthEnd}&invoiced=eq.false&status=eq.open&select=client_id`,
    { headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey } }
  );
  const appts = await apptRes.json();
  if (!Array.isArray(appts) || appts.length === 0) {
    return res.status(200).json({ sent: 0, trigger, reason: 'No pending appointments this month' });
  }

  const clientIds = [...new Set(appts.map(a => a.client_id))];

  const [clientRes, contractRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/clients?id=in.(${clientIds.join(',')})&select=id,name`, {
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
    }),
    fetch(`${SB_URL}/rest/v1/contracts?party_type=eq.client&status=eq.signed&select=email,party&order=signed_at.desc`, {
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
    }),
  ]);

  const clients = await clientRes.json();
  const contracts = await contractRes.json();

  const buildEmail = (cl, pending, trigger) => {
    const accentColor = trigger === 'last' ? '#e8314a' : trigger === 'second' ? '#f5a623' : '#f5a623';
    const topBarColor = trigger === 'last'
      ? 'linear-gradient(90deg,#e8314a,#b71c1c)'
      : 'linear-gradient(90deg,#f5a623,#e8830a)';

    const badge = trigger === 'last'
      ? 'Laatste dag — facturatie start vandaag'
      : trigger === 'second'
      ? 'Dringende herinnering — 2 dagen resterend'
      : 'Actie vereist — factuuroverzicht';

    const headline = trigger === 'last'
      ? `Laatste kans:<br>statussen bijwerken voor ${cl.name}`
      : trigger === 'second'
      ? `Nog 2 dagen:<br>controleer uw afspraken`
      : `Overzicht ${monthLabel}<br>staat klaar voor review`;

    const body = trigger === 'last'
      ? `Beste ${cl.name},<br><br>
         Vandaag is de <strong style="color:#ffffff;">laatste dag van de maand</strong>. U heeft nog <strong style="color:#ffffff;">${pending} afspra${pending === 1 ? 'ak' : 'ken'}</strong> waarvoor de status niet definitief is ingesteld.<br><br>
         <strong style="color:#e8314a;">Indien wij voor het einde van vandaag geen feedback ontvangen, factureren wij alle openstaande afspraken automatisch.</strong> Dit geldt als uitdrukkelijke mededeling conform uw contract.`
      : trigger === 'second'
      ? `Beste ${cl.name},<br><br>
         Er zijn nog maar <strong style="color:#ffffff;">2 dagen</strong> over. U heeft nog <strong style="color:#ffffff;">${pending} afspra${pending === 1 ? 'ak' : 'ken'}</strong> zonder definitieve status.<br><br>
         Gelieve uiterlijk <strong style="color:#f5a623;">${deadlineStr}</strong> alle afspraken te controleren. <strong style="color:#ffffff;">Indien wij geen feedback ontvangen, worden alle openstaande afspraken automatisch gefactureerd.</strong>`
      : `Beste ${cl.name},<br><br>
         Het einde van de maand nadert. U heeft nog <strong style="color:#ffffff;">${pending} afspra${pending === 1 ? 'ak' : 'ken'}</strong> waarvoor de status nog niet definitief is bijgewerkt.<br><br>
         Gelieve uiterlijk <strong style="color:#f5a623;">${deadlineStr}</strong> alle afspraken te controleren en de juiste status in te stellen. <strong style="color:#ffffff;">Afspraken zonder definitieve status worden automatisch gefactureerd.</strong>`;

    const footer = trigger === 'last'
      ? `Facturatie start <strong style="color:#8b9bbf;">vandaag, ${deadlineStr}</strong>. Alle open afspraken van ${monthLabel} worden verwerkt.`
      : `Op <strong style="color:#8b9bbf;">1 ${nextMonthStr}</strong> worden alle open afspraken van ${monthLabel} automatisch verwerkt en gefactureerd.`;

    return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="padding:0 0 28px 0;" align="center">
        <table cellpadding="0" cellspacing="0"><tr>
          <td><img src="https://platform.infinite-scale.be/logo.svg" width="40" height="40" alt="IS" style="display:block;border-radius:50%;"/></td>
          <td style="padding-left:10px;font-size:17px;font-weight:700;color:#ffffff;">Infinite Scale</td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#181c27;border-radius:18px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
        <tr><td style="height:4px;background:${topBarColor};"></td></tr>
        <tr><td style="padding:40px 44px 36px;">
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${accentColor};font-weight:700;">${badge}</p>
          <h1 style="margin:0 0 20px;font-size:26px;font-weight:800;color:#ffffff;line-height:1.15;">${headline}</h1>
          <p style="margin:0 0 28px;font-size:15px;line-height:1.75;color:#8b9bbf;">${body}</p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="background:#67dcdf;border-radius:12px;">
              <a href="https://platform.infinite-scale.be" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:800;color:#071a1a;text-decoration:none;">Ga naar het platform →</a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:13px;color:#5a6a8a;line-height:1.5;">${footer}</p>
        </td></tr>
        <tr><td style="padding:20px 44px 28px;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0;font-size:12px;color:#3d4d6a;">© ${now.getFullYear()} Curabond BV · Infinite Scale · platform.infinite-scale.be</p>
        </td></tr>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  };

  const subjects = {
    first:  `Afsprakenoverzicht ${monthLabel} — controleer uw statussen voor ${deadlineStr}`,
    second: `Herinnering: nog 2 dagen om afspraken te controleren — ${monthLabel}`,
    last:   `LAATSTE DAG: statussen bijwerken of alles wordt gefactureerd — ${monthLabel}`,
  };

  const results = [];
  for (const cl of clients) {
    const contract = contracts.find(c => c.party && c.party.toLowerCase().includes(cl.name.toLowerCase()));
    const email = contract?.email;
    if (!email) { results.push({ id: cl.id, skipped: 'no email' }); continue; }

    const pending = appts.filter(a => a.client_id === cl.id).length;
    const html = buildEmail(cl, pending, trigger);

    const r = await fetch('https://platform.infinite-scale.be/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: email, subject: subjects[trigger], html }),
    });
    const rj = await r.json().catch(() => ({}));
    results.push({ id: cl.id, email, trigger, sent: rj.ok === true });
  }

  console.log(`[invoice-reminder] trigger=${trigger}, month=${currentYM}:`, results);
  return res.status(200).json({ month: currentYM, trigger, results });
}
