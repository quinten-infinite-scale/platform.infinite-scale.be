-- contracts: startup cost invoicing + account linking
-- Run in Supabase SQL editor (already executed on 2026-10-08)

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS setup_fee_invoiced boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS linked_client_id text,
  ADD COLUMN IF NOT EXISTS linked_agent_id text;
