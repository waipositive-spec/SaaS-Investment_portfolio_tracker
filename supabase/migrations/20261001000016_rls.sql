-- 0016_rls.sql
-- Physical Schema/RLS v0.1, Section 12.
-- Enable RLS and add policies per the policy-class table. Append-only
-- observation tables (valuations, loan balance/rate history, audit_events)
-- get SELECT+INSERT only — no UPDATE/DELETE policy for ordinary roles, so
-- history can never be edited or removed by a client (DBV-03/04/05).
-- Soft-history tables get no DELETE policy at all; archiving is an UPDATE
-- that sets an archived_at/status column.

-- ---------------------------------------------------------------------
-- tenants: a gap in the physical schema doc's Section 12 policy table —
-- every other customer table is scoped BY a tenant_id column, but the
-- tenants row itself was never given a policy. A member may read their
-- own tenant row; there is no client INSERT/UPDATE/DELETE policy at all —
-- tenants are only created via bootstrap_tenant(), a SECURITY DEFINER
-- function owned by the table owner, which bypasses RLS the same way
-- every other trusted bootstrap/conversion function here does.
-- ---------------------------------------------------------------------
alter table public.tenants enable row level security;

create policy tenants_select on public.tenants for select
  using (public.is_tenant_member(id));

-- ---------------------------------------------------------------------
-- user_profiles: user reads/updates own profile only.
-- ---------------------------------------------------------------------
alter table public.user_profiles enable row level security;

create policy user_profiles_select_own on public.user_profiles for select
  using (id = auth.uid());
create policy user_profiles_update_own on public.user_profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- tenant_memberships
-- ---------------------------------------------------------------------
alter table public.tenant_memberships enable row level security;

create policy tenant_memberships_select on public.tenant_memberships for select
  using (public.is_tenant_member(tenant_id));
create policy tenant_memberships_insert on public.tenant_memberships for insert
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));
create policy tenant_memberships_update on public.tenant_memberships for update
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------
-- Standard tenant tables: full-member SELECT, member INSERT/UPDATE,
-- no ordinary DELETE policy (archive via UPDATE instead).
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  standard_tables text[] := array[
    'owners', 'households', 'household_members',
    'portfolios', 'assets', 'property_addresses', 'properties', 'asset_ownerships',
    'loans',
    'goals'
  ];
begin
  foreach t in array standard_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_tenant_member(tenant_id));',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for insert with check (public.is_tenant_member(tenant_id));',
      t || '_insert', t
    );
    execute format(
      'create policy %I on public.%I for update using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));',
      t || '_update', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Append-only observation/history tables: SELECT + INSERT only.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  append_only_tables text[] := array[
    'valuations', 'valuation_selections',
    'loan_balance_snapshots', 'loan_rate_periods',
    'audit_events'
  ];
begin
  foreach t in array append_only_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_tenant_member(tenant_id));',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for insert with check (public.is_tenant_member(tenant_id));',
      t || '_insert', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Evidence / Reporting (MVP1: schema + RLS only, no UI until MVP2).
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  evidence_reporting_tables text[] := array[
    'evidence_documents', 'transaction_evidence', 'report_runs', 'export_artifacts'
  ];
begin
  foreach t in array evidence_reporting_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_tenant_member(tenant_id));',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for insert with check (public.is_tenant_member(tenant_id));',
      t || '_insert', t
    );
  end loop;
end;
$$;

-- Transactions: standard member SELECT/INSERT/UPDATE (correction updates go
-- through correctTransaction which also writes an audit event in the same
-- transaction — see API Contracts Section 8).
alter table public.transactions enable row level security;
create policy transactions_select on public.transactions for select
  using (public.is_tenant_member(tenant_id));
create policy transactions_insert on public.transactions for insert
  with check (public.is_tenant_member(tenant_id));
create policy transactions_update on public.transactions for update
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
-- No DELETE policy: correction/archival only, never a hard delete of
-- accounting history.

-- ---------------------------------------------------------------------
-- property_assessments and children: tenant-member policy, but ONLY once
-- tenant_id is set (post-conversion if it started as Lead-owned). While
-- tenant_id is NULL there is no client-role policy at all for any of
-- these four tables — every access goes through the server's
-- service-role-mediated assessment API, the same pattern as leads.
-- ---------------------------------------------------------------------
alter table public.property_assessments enable row level security;
create policy property_assessments_select on public.property_assessments for select
  using (tenant_id is not null and public.is_tenant_member(tenant_id));
create policy property_assessments_insert on public.property_assessments for insert
  with check (tenant_id is not null and public.is_tenant_member(tenant_id));
create policy property_assessments_update on public.property_assessments for update
  using (tenant_id is not null and public.is_tenant_member(tenant_id))
  with check (tenant_id is not null and public.is_tenant_member(tenant_id));

alter table public.assessment_scenarios enable row level security;
create policy assessment_scenarios_select on public.assessment_scenarios for select
  using (tenant_id is not null and public.is_tenant_member(tenant_id));
create policy assessment_scenarios_insert on public.assessment_scenarios for insert
  with check (tenant_id is not null and public.is_tenant_member(tenant_id));
create policy assessment_scenarios_update on public.assessment_scenarios for update
  using (tenant_id is not null and public.is_tenant_member(tenant_id))
  with check (tenant_id is not null and public.is_tenant_member(tenant_id));

alter table public.assessment_expense_items enable row level security;
create policy assessment_expense_items_select on public.assessment_expense_items for select
  using (tenant_id is not null and public.is_tenant_member(tenant_id));
create policy assessment_expense_items_insert on public.assessment_expense_items for insert
  with check (tenant_id is not null and public.is_tenant_member(tenant_id));
create policy assessment_expense_items_update on public.assessment_expense_items for update
  using (tenant_id is not null and public.is_tenant_member(tenant_id))
  with check (tenant_id is not null and public.is_tenant_member(tenant_id));

alter table public.assessment_promotions enable row level security;
create policy assessment_promotions_select on public.assessment_promotions for select
  using (public.is_tenant_member(tenant_id));
create policy assessment_promotions_insert on public.assessment_promotions for insert
  with check (public.is_tenant_member(tenant_id));

-- ---------------------------------------------------------------------
-- valuation_sources / transaction_categories: read approved global rows
-- (tenant_id null) plus own tenant rows; global writes are service/admin
-- only (no authenticated-role insert/update policy on a null-tenant row).
-- ---------------------------------------------------------------------
alter table public.valuation_sources enable row level security;
create policy valuation_sources_select on public.valuation_sources for select
  using (tenant_id is null or public.is_tenant_member(tenant_id));
create policy valuation_sources_insert on public.valuation_sources for insert
  with check (tenant_id is not null and public.is_tenant_member(tenant_id));

alter table public.transaction_categories enable row level security;
create policy transaction_categories_select on public.transaction_categories for select
  using (tenant_id is null or public.is_tenant_member(tenant_id));
create policy transaction_categories_insert on public.transaction_categories for insert
  with check (tenant_id is not null and public.is_tenant_member(tenant_id));

-- leads: RLS already enabled in 0004_marketing.sql with deliberately zero
-- anon/authenticated policies — nothing to add here.
