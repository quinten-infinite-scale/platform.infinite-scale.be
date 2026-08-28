-- WhatsApp Automation: Migration
-- Run in Supabase SQL editor at https://database.infinite-scale.be

-- 1. client_whatsapp_templates
CREATE TABLE IF NOT EXISTS client_whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  template_name text NOT NULL,
  template_language text NOT NULL DEFAULT 'nl',
  reminder_hours_before int NOT NULL DEFAULT 24,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. whatsapp_messages
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id text,
  client_id text,
  phone text,
  direction text NOT NULL DEFAULT 'outbound',  -- 'outbound' | 'inbound'
  message_type text NOT NULL,                  -- 'confirmation' | 'reminder' | 'reply'
  template_name text,
  whatsapp_message_id text,                    -- Meta message id for status tracking
  status text NOT NULL DEFAULT 'sent',         -- 'sent' | 'delivered' | 'read' | 'failed'
  status_updated_at timestamptz,
  content text,                                -- for inbound messages
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for status webhook lookups
CREATE INDEX IF NOT EXISTS whatsapp_messages_wa_msgid ON whatsapp_messages (whatsapp_message_id);
-- Index for phone thread lookups
CREATE INDEX IF NOT EXISTS whatsapp_messages_phone ON whatsapp_messages (phone);
-- Index for appointment thread lookups
CREATE INDEX IF NOT EXISTS whatsapp_messages_appt ON whatsapp_messages (appointment_id);

-- 3. Add columns to appointments table
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- 4. Seed: test template for Renocheck (client_id = 'c15')
-- Uses Meta's built-in test template "hello_world" so the system works before
-- real templates are approved. Swap template_name and template_language once
-- your real client-branded templates are approved in Meta Business Manager.
INSERT INTO client_whatsapp_templates (client_id, template_name, template_language, reminder_hours_before, active)
VALUES ('c15', 'hello_world', 'en_US', 24, true)
ON CONFLICT DO NOTHING;
