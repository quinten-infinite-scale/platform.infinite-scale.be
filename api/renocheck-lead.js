const CAT_SLUGS = {
  'Airco': 'airco',
  'Thuisbatt': 'thuisbatterijen',
  'Zonnepanelen': 'zonnepanelen',
  'Ramen en deuren': 'ramen-deuren',
  'Keukens': 'keuken',
  'Badkamers': 'badkamer',
  'Crepi': 'crepi',
  'Dak': 'dak-renovatie',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    category, firstname, lastname, email, phonenumber,
    street, number, zipcode, city, external_id, description, data,
  } = req.body || {};

  if (!category || !firstname || !phonenumber) {
    return res.status(400).json({ error: 'Missing required fields: category, firstname, phonenumber' });
  }

  const category_slug = CAT_SLUGS[category];
  if (!category_slug) {
    return res.status(400).json({ error: 'Unknown category: ' + category });
  }

  const payload = {
    category: category_slug,
    full_name: [firstname, lastname || ''].filter(Boolean).join(' '),
    phone: phonenumber,
    email: email || '',
    street: street || '',
    number: number || '',
    zipcode: zipcode || '',
    city: city || '',
    external_id: external_id || ('IS-' + Date.now()),
    ...(description ? { description } : {}),
    ...(data ? { data } : {}),
  };

  const r = await fetch('https://renocheck.be/api/v2/leads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': '9bc5fb0e-2ca3-4779-ae84-4a13bcac6271',
    },
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  if (!r.ok) {
    console.error('renocheck-lead error:', r.status, text);
    return res.status(r.status).json({ error: text });
  }

  let data2;
  try { data2 = JSON.parse(text); } catch { data2 = { raw: text }; }
  return res.status(200).json({ ok: true, data: data2 });
}
