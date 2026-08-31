/**
 * Server-side proxy for contract PDF uploads to Supabase Storage.
 * Uses service role key to bypass storage RLS.
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-file-path');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const path = req.headers['x-file-path'];
  if (!path) return res.status(400).json({ ok: false, error: 'x-file-path header required' });

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);

  const r = await fetch(`${SB_URL}/storage/v1/object/contracts/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': req.headers['content-type'] || 'application/pdf',
    },
    body: buffer,
  });

  const text = await r.text();
  if (!r.ok) return res.status(r.status).json({ ok: false, error: text });

  const publicUrl = `${SB_URL}/storage/v1/object/public/contracts/${path}`;
  return res.status(200).json({ ok: true, url: publicUrl });
}
