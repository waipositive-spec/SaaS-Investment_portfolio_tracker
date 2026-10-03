-- 0015_indexes.sql
-- Physical Schema/RLS v0.1, Section 14.
-- Most of the index baseline was created inline with each table (dashboard
-- assets, latest valuation, latest debt, ledger, evidence, assessment,
-- lead, audit). This migration covers the baseline entries not yet
-- satisfied by an inline index.

-- (All index-baseline rows from Section 14 are covered by indexes created
-- in 0002-0013. This file is intentionally left as a placeholder step in
-- the numbered sequence so the migration order in docs/decisions matches
-- the files on disk 1:1 — add any future cross-cutting index here rather
-- than reopening an earlier migration.)
select 1;
