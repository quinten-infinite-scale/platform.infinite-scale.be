// Vercel cron: runs 1st of each month at 02:00 UTC
// Marks all previous month's pending billable appointments as invoiced
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  // Vercel cron sends Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SB_URL = 'https://database.infinite-scale.be';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Service key not configured' });

  const now = new Date();
  // Previous month bounds
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevYM = prevStart.getFullYear() + '-' + String(prevStart.getMonth() + 1).padStart(2, '0');
  const thisYM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  const r = await fetch(
    `${SB_URL}/rest/v1/appointments?date_appt=gte.${prevYM}-01&date_appt=lt.${thisYM}-01&invoiced=eq.false&status=not.in.(cancel,no_show)`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ invoiced: true }),
    }
  );

  if (!r.ok) {
    const err = await r.text();
    console.error('auto-invoice PATCH failed:', err);
    return res.status(500).json({ error: err });
  }

  const data = await r.json();
  console.log(`[auto-invoice] Marked ${data.length} appointments as invoiced for ${prevYM}`);
  return res.status(200).json({ invoiced: data.length, month: prevYM });
}
