-- 0014_tenant_integrity.sql
-- Physical Schema/RLS v0.1, Section 11.
-- Most composite tenant-aware FKs (parent UNIQUE(id,tenant_id) + child
-- FK(child_fk,tenant_id) REFERENCES parent(id,tenant_id)) were added inline
-- in the migration that created each child table, because Postgres requires
-- the parent UNIQUE constraint to exist before a child FK can reference it,
-- and keeping them next to the table they constrain is easier to audit than
-- a single end-of-sequence migration. This migration covers the one
-- remaining case plus a verification query.
--
-- property_assessments.tenant_id is nullable (Lead-owned, pre-conversion),
-- so per the physical schema's own guidance (Section 11) its children
-- (assessment_scenarios, assessment_expense_items, assessment_promotions)
-- do NOT get a composite tenant-aware FK while that nullable state is
-- possible — that would reject the valid pre-conversion row. Enforcement
-- for that case is the convert_lead() function's atomic reattachment
-- (0011_assessment.sql), not a DB constraint.

-- A partial unique index (rather than a plain composite UNIQUE) supports a
-- composite FK from a future always-authenticated child while leaving the
-- nullable pre-conversion state valid.
create unique index property_assessments_id_tenant_uk
  on public.property_assessments (id, tenant_id)
  where tenant_id is not null;

-- Verification query (run manually / in CI, not enforced as DDL): every
-- customer-owned table other than leads/property_assessments should carry
-- a NOT NULL tenant_id and a matching composite FK on its tenant-scoped
-- children. See 0019_verification.sql for the automated check.
