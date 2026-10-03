-- 0008_liabilities.sql
-- Physical Schema/RLS v0.1, Section 7.
-- Loan balances/rates are append-only snapshots (DBV-05); "current balance"
-- is always the latest applicable snapshot, never a mutable Loan.balance field.

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  lender_name text not null,
  loan_name text,
  original_principal numeric(19, 4) not null,
  currency char(3) not null default 'AUD',
  start_date date not null,
  repayment_type text not null,
  rate_type text not null,
  term_months integer not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loans_principal_chk check (original_principal >= 0),
  constraint loans_term_chk check (term_months > 0),
  constraint loans_repayment_type_chk check (repayment_type in ('IO', 'P_AND_I')),
  constraint loans_rate_type_chk check (rate_type in ('fixed', 'variable')),
  constraint loans_status_chk check (status in ('active', 'discharged', 'refinanced'))
);
create index loans_asset_status_idx on public.loans (asset_id, status);
alter table public.loans add constraint loans_id_tenant_uk unique (id, tenant_id);
alter table public.loans
  add constraint loans_asset_tenant_fk
  foreign key (asset_id, tenant_id) references public.assets (id, tenant_id);

create table public.loan_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  loan_id uuid not null references public.loans (id) on delete cascade,
  balance numeric(19, 4) not null,
  offset_balance numeric(19, 4) not null default 0,
  effective_date date not null,
  recorded_at timestamptz not null default now(),
  source text not null default 'user_entered',
  classification text not null default 'actual',
  constraint loan_balance_snapshots_balance_chk check (balance >= 0 and offset_balance >= 0)
);
create index loan_balance_snapshots_loan_effective_idx
  on public.loan_balance_snapshots (loan_id, effective_date desc);
alter table public.loan_balance_snapshots
  add constraint loan_balance_snapshots_loan_tenant_fk
  foreign key (loan_id, tenant_id) references public.loans (id, tenant_id);

create table public.loan_rate_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  loan_id uuid not null references public.loans (id) on delete cascade,
  annual_rate numeric(12, 8) not null,
  effective_from date not null,
  effective_to date,
  rate_type text not null,
  source text not null default 'user_entered',
  constraint loan_rate_periods_rate_chk check (annual_rate >= 0),
  constraint loan_rate_periods_effective_chk check (effective_to is null or effective_to >= effective_from)
);
alter table public.loan_rate_periods
  add constraint loan_rate_periods_loan_tenant_fk
  foreign key (loan_id, tenant_id) references public.loans (id, tenant_id);
