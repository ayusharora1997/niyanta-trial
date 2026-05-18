-- Migration: add filters_applied + ensure keyword/search_url exist on search_runs
-- Run once against your Supabase project (SQL Editor or psql)

ALTER TABLE search_runs
  ADD COLUMN IF NOT EXISTS filters_applied JSONB    NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS keyword         TEXT,
  ADD COLUMN IF NOT EXISTS search_url      TEXT;

COMMENT ON COLUMN search_runs.filters_applied IS
  'Active filter chips detected on the IndiaMART search page at scrape time. Array of {label, value}.';
COMMENT ON COLUMN search_runs.keyword IS
  'Raw input keyword used to construct the search URL.';
COMMENT ON COLUMN search_runs.search_url IS
  'Constructed IndiaMART search URL (dir.indiamart.com/search.mp?ss=...).';
