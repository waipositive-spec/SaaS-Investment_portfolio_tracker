-- 0009_ledger.sql
-- Physical Schema/RLS v0.1, Section 8.
-- transaction_date earlier than the asset's tracking_start_date is rejected
-- by the application layer (createTransaction -> BEFORE_TRACKING_START),
-- not by a DB CHECK, since a trusted backfill/correction workflow is a
-- legitimate exception (DM-18).

create table public.transaction_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  code text not null,
  name text not null,
  category_group text not null,
  active boolean not null default true,
  tax_mapping text,
  sort_order integer not null default 0,
  constraint transaction_categories_group_chk
    check (category_group in ('income', 'operating_expense', 'finance', 'principal', 'capital_expenditure', 'transfer', 'other'))
);
-- Global categories (tenant_id null) share a code namespace distinct from
-- tenant-specific ones.
create unique index transaction_categories_global_code_uk
  on public.transaction_categories (code) where tenant_id is null;
create unique index transaction_categories_tenant_code_uk
  on public.transaction_categories (tenant_id, code) where tenant_id is not null;

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  transaction_date date not null,
  amount numeric(19, 4) not null,
  currency char(3) not null default 'AUD',
  direction text not null,
  category_id uuid references public.transaction_categories (id),
  description text,
  counterparty text,
  external_reference text,
  source text not null default 'user_entered',
  classification text not null default 'actual',
  review_status text not null default 'confirmed',
  created_by uuid references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint transactions_amount_chk check (amount > 0),
  constraint transactions_direction_chk
    check (direction in ('income', 'expense', 'transfer_in', 'transfer_out'))
);
create index transactions_asset_date_idx on public.transactions (asset_id, transaction_date desc);
create index transactions_tenant_date_idx on public.transactions (tenant_id, transaction_date desc);
create index transactions_category_date_idx on public.transactions (category_id, transaction_date);
alter table public.transactions
  add constraint transactions_asset_tenant_fk
  foreign key (asset_id, tenant_id) references public.assets (id, tenant_id);
alter table public.transactions add constraint transactions_id_tenant_uk unique (id, tenant_id);
