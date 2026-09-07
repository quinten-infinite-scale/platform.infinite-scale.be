-- Prospect CRM pipeline upgrade
-- Run in Supabase SQL editor

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS pipeline_id text DEFAULT 'manuele',
  ADD COLUMN IF NOT EXISTS status     text,
  ADD COLUMN IF NOT EXISTS caller_note text,
  ADD COLUMN IF NOT EXISTS call_on    date,
  ADD COLUMN IF NOT EXISTS revenue    text,
  ADD COLUMN IF NOT EXISTS ad_name    text,
  ADD COLUMN IF NOT EXISTS lead_id    text,
  ADD COLUMN IF NOT EXISTS ad_id      text,
  ADD COLUMN IF NOT EXISTS form_id    text;

-- Migrate all existing prospects into the "manuele" pipeline
UPDATE prospects SET pipeline_id = 'manuele' WHERE pipeline_id IS NULL;

-- Map old stage IDs to new stage IDs used by the board
UPDATE prospects SET stage = 'nieuwe_leads'       WHERE stage = 'new';
UPDATE prospects SET stage = 'first_call'         WHERE stage = 'first';
UPDATE prospects SET stage = 'gewonnen'           WHERE stage = 'closed';
UPDATE prospects SET stage = 'niet_gewonnen'      WHERE stage = 'lost';
UPDATE prospects SET stage = 'follow_up_call'     WHERE stage = 'followup';
UPDATE prospects SET stage = 'herplan_call'       WHERE stage = 'meeting';
