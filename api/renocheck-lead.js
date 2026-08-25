export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { category, full_name, email, phone, address, postal_code, city, description } = req.body || {};
  if (!category || !full_name || !phone) {
    return res.status(400).json({ error: 'Missing required fields: category, full_name, phone' });
  }

  const r = await fetch('https://renocheck.be/api/v1/leads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': '9bc5fb0e-2ca3-4779-ae84-4a13bcac6271',
    },
    body: JSON.stringify({
      category: category.toLowerCase().replace(/ /g, '_'),
      full_name,
      email: email || '',
      phone,
      Address: address || '',
      postal_code: postal_code || '',
      city: city || '',
      description: description || '',
      external_id: 'Infinite Scale',
    }),
  });

  const text = await r.text();
  if (!r.ok) {
    console.error('renocheck-lead error:', r.status, text);
    return res.status(r.status).json({ error: text });
  }

  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return res.status(200).json({ ok: true, data });
}
