export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Service key not configured' });

  const raw = req.body;
  if (!raw || !raw.id) {
    return res.status(400).json({ error: 'Missing required field: id' });
  }

  // Only pass known columns — ignore any extra form fields the browser may send
  const KNOWN = ['id','party','party_type','type','status','sent','value','email','vat','address','contact','duration','notes','setup_fee','signing_link','sign_token','signed_at','signer_name','signature_image','contract_html'];
  const contract = Object.fromEntries(Object.entries(raw).filter(([k]) => KNOWN.includes(k)));

  const r = await fetch('https://database.infinite-scale.be/rest/v1/contracts', {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': 'Bearer ' + serviceKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(contract),
  });

  if (!r.ok) {
    const err = await r.text();
    console.error('save-contract error:', err);
    return res.status(r.status).json({ error: err });
  }

  return res.status(201).json({ ok: true });
}
