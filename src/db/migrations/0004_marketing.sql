-- 0004_marketing.sql
-- Physical Schema/RLS v0.1, Section 3a.
-- leads: deliberately has NO tenant_id (DM-19) and NO client-role RLS
-- policy at all (enabled below, but zero anon/authenticated policies
-- added here or in 0016) — every read/write is service-role/server-mediated,
-- mirroring ADR-022's public-endpoint trust boundary.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  phone text,
  consent_captured_at timestamptz not null default now(),
  consent_type text not null,
  crm_provider text,
  crm_external_id text,
  crm_sync_status text not null default 'pending',
  converted_user_id uuid references public.user_profiles (id),
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint leads_consent_type_chk check (consent_type in ('account_necessary', 'marketing')),
  constraint leads_crm_sync_status_chk check (crm_sync_status in ('pending', 'synced', 'failed'))
);

-- Avoid duplicate *open* leads for the same prospect; a converted lead's
-- email may legitimately reappear for a new, unrelated submission.
create unique index leads_email_open_uk
  on public.leads (lower(email))
  where converted_user_id is null;

create index leads_crm_sync_status_idx on public.leads (crm_sync_status);

alter table public.leads enable row level security;
-- Intentionally no CREATE POLICY statements for anon/authenticated roles.
-- See Section 12/DBV-13 in the physical schema doc.
