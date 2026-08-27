// Category ID mapping — verify these with Renocheck if needed; Dak=7 is confirmed
const CAT_IDS = {
  'Airco': '1',
  'Thuisbatt': '2',
  'Zonnepanelen': '3',
  'Ramen en deuren': '4',
  'Keukens': '5',
  'Badkamers': '6',
  'Crepi': '8',
  'Dak': '7',
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

  const category_id = CAT_IDS[category];
  if (!category_id) {
    return res.status(400).json({ error: 'Unknown category: ' + category });
  }

  const payload = {
    category_id,
    category,
    full_name: [firstname, lastname || ''].filter(Boolean).join(' '),
    firstname,
    lastname: lastname || '',
    email: email || '',
    phone: phonenumber,
    phonenumber,
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
