-- client_resources: per-client resource hub (script, logins, productkennis, leadlijsten, canvases)
CREATE TABLE IF NOT EXISTS client_resources (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL UNIQUE,
  script text DEFAULT '',
  logins jsonb DEFAULT '[]',
  productkennis text DEFAULT '',
  leadlijsten jsonb DEFAULT '[]',
  canvases jsonb DEFAULT '[]',
  -- vis: visibility config per tab per audience
  -- {"script":{"agent":true,"client":true},"login":{"agent":true,"client":true},...}
  vis jsonb DEFAULT '{"script":{"agent":true,"client":true},"login":{"agent":true,"client":true},"product":{"agent":true,"client":true},"leads":{"agent":true,"client":true},"canvas":{"agent":true,"client":true}}',
  updated_at timestamptz DEFAULT now(),
  updated_by text
);

ALTER TABLE client_resources ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all resources (visibility filtering happens in app layer)
CREATE POLICY "Authenticated read" ON client_resources
  FOR SELECT USING (auth.role() = 'authenticated');
