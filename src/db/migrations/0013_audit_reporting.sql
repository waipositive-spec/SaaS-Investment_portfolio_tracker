-- 0013_audit_reporting.sql
-- Physical Schema/RLS v0.1, Section 10.
-- audit_events: append-only, material mutations only (ADR-015).
-- report_runs/export_artifacts: MVP1 schema only, no UI until MVP2.

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  actor_user_id uuid references public.user_profiles (id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  occurred_at timestamptz not null default now(),
  correlation_id uuid,
  change_set jsonb,
  metadata jsonb
);
create index audit_events_tenant_entity_occurred_idx
  on public.audit_events (tenant_id, entity_type, entity_id, occurred_at desc);

create table public.report_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  report_type text not null,
  asset_id uuid references public.assets (id),
  period_start date,
  period_end date,
  calculation_version text not null,
  generated_by uuid references public.user_profiles (id),
  generated_at timestamptz not null default now(),
  status text not null default 'completed',
  parameters jsonb,
  source_snapshot_metadata jsonb
);

create table public.export_artifacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  report_run_id uuid not null references public.report_runs (id) on delete cascade,
  storage_bucket text not null,
  storage_path text not null,
  mime_type text not null,
  content_hash_sha256 text not null,
  created_at timestamptz not null default now(),
  constraint export_artifacts_tenant_path_uk unique (tenant_id, storage_path)
);
