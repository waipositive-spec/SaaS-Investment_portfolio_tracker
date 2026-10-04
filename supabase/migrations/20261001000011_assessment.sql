-- 0011_assessment.sql
-- Physical Schema/RLS v0.1, Section 9.
-- property_assessments.tenant_id is nullable (Lead-owned, pre-conversion);
-- exactly one of created_by_lead_id/created_by_user_id is set (DM-17).
-- assessment_scenarios is already typed (not EAV) per ADR-017's
-- finalised FR-79 input list.

create table public.property_assessments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  created_by_lead_id uuid references public.leads (id),
  created_by_user_id uuid references public.user_profiles (id),
  address_id uuid,
  title text,
  asking_price numeric(19, 4),
  currency char(3) not null default 'AUD',
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint property_assessments_status_chk check (status in ('draft', 'active', 'archived', 'promoted')),
  constraint property_assessments_asking_price_chk check (asking_price is null or asking_price >= 0),
  constraint property_assessments_creator_chk
    check (num_nonnulls(created_by_lead_id, created_by_user_id) = 1)
);
create index property_assessments_tenant_status_idx
  on public.property_assessments (tenant_id, status, updated_at desc);
create index property_assessments_lead_status_idx
  on public.property_assessments (created_by_lead_id, status, updated_at desc);
alter table public.property_assessments
  add constraint property_assessments_address_tenant_fk
  foreign key (address_id, tenant_id) references public.property_addresses (id, tenant_id);

create table public.assessment_scenarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  assessment_id uuid not null references public.property_assessments (id) on delete cascade,
  name text not null,
  is_baseline boolean not null default false,
  proposed_purchase_price numeric(19, 4),
  estimated_rent_amount numeric(19, 4),
  rent_frequency text,
  vacancy_rate numeric(6, 5),
  proposed_loan numeric(19, 4),
  interest_rate numeric(8, 5),
  loan_term_months integer,
  repayment_type text,
  repayment_frequency text,
  acquisition_costs numeric(19, 4),
  immediate_works numeric(19, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessment_scenarios_vacancy_chk check (vacancy_rate is null or (vacancy_rate >= 0 and vacancy_rate <= 1)),
  constraint assessment_scenarios_rate_chk check (interest_rate is null or interest_rate >= 0),
  constraint assessment_scenarios_term_chk check (loan_term_months is null or loan_term_months > 0),
  constraint assessment_scenarios_repayment_type_chk check (repayment_type is null or repayment_type in ('IO', 'P_AND_I')),
  constraint assessment_scenarios_rent_frequency_chk
    check (rent_frequency is null or rent_frequency in ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'ANNUALLY')),
  constraint assessment_scenarios_repayment_frequency_chk
    check (repayment_frequency is null or repayment_frequency in ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY'))
);
-- At most one baseline scenario per assessment (DBV-11).
create unique index assessment_scenarios_one_baseline_uk
  on public.assessment_scenarios (assessment_id) where is_baseline;

create table public.assessment_expense_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  scenario_id uuid not null references public.assessment_scenarios (id) on delete cascade,
  expense_type text not null,
  amount numeric(19, 4) not null,
  frequency text not null,
  notes text,
  constraint assessment_expense_items_amount_chk check (amount >= 0),
  constraint assessment_expense_items_frequency_chk
    check (frequency in ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'ANNUALLY'))
);

create table public.assessment_promotions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  assessment_id uuid not null unique references public.property_assessments (id),
  asset_id uuid not null unique references public.assets (id),
  promoted_at timestamptz not null default now(),
  promoted_by uuid references public.user_profiles (id)
);
alter table public.assessment_promotions
  add constraint assessment_promotions_asset_tenant_fk
  foreign key (asset_id, tenant_id) references public.assets (id, tenant_id);

-- Lead conversion: trusted server-side function, called atomically with
-- bootstrap_tenant when converting_lead_id is present (API Contracts
-- Section 3 convertLead / Physical Schema Section 15, DBV-15).
create or replace function public.convert_lead(p_lead_id uuid, p_user_id uuid, p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.leads
  set converted_user_id = p_user_id, converted_at = now()
  where id = p_lead_id and converted_user_id is null;

  update public.property_assessments
  set tenant_id = p_tenant_id, created_by_user_id = p_user_id, updated_at = now()
  where created_by_lead_id = p_lead_id and tenant_id is null;
end;
$$;

revoke all on function public.convert_lead(uuid, uuid, uuid) from public;
