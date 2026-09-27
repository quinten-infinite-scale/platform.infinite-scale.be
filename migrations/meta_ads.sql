-- Meta Lead Ads integration schema
-- Run in Supabase SQL editor

-- Page/form → pipeline/stage mapping table
CREATE TABLE IF NOT EXISTS meta_lead_mappings (
  id              text PRIMARY KEY,
  facebook_page_id text NOT NULL,
  facebook_form_id text,           -- NULL = wildcard (any form on this page)
  target_pipeline_id text NOT NULL DEFAULT 'meta_ads',
  target_stage_id    text NOT NULL DEFAULT 'nieuwe_leads',
  owner_id           text,         -- salesperson or agent id (optional)
  field_map          jsonb NOT NULL DEFAULT '{}', -- { "fb_question_key": "crm_field" }
  label              text,         -- human-readable name for this mapping
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Lead ingestion audit log (dedupe + debug)
CREATE TABLE IF NOT EXISTS meta_lead_log (
  id           text PRIMARY KEY,
  leadgen_id   text NOT NULL UNIQUE, -- Facebook's lead ID — used for dedupe
  page_id      text NOT NULL,
  form_id      text NOT NULL,
  mapping_id   text,                 -- which mapping was used (null = unmapped)
  prospect_id  text,                 -- created/updated CRM record
  status       text NOT NULL,        -- 'success' | 'unmapped' | 'failed'
  error        text,
  raw_payload  jsonb,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS meta_lead_log_received_at ON meta_lead_log (received_at DESC);
CREATE INDEX IF NOT EXISTS meta_lead_mappings_page ON meta_lead_mappings (facebook_page_id, facebook_form_id);
