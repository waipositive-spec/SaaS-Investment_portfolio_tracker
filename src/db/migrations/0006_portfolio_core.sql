-- 0006_portfolio_core.sql
-- Physical Schema/RLS v0.1, Section 5.
-- assets.tracking_start_date resolves FR-25 (DM-18): periods before it are
-- "not tracked", never a fabricated $0.

create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  base_currency char(3) not null default 'AUD',
  portfolio_type text not null default 'personal',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolios_status_chk check (status in ('active', 'archived'))
);
create index portfolios_tenant_status_idx on public.portfolios (tenant_id, status);
alter table public.portfolios add constraint portfolios_id_tenant_uk unique (id, tenant_id);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  asset_type text not null,
  display_name text not null,
  status text not null default 'active',
  acquired_date date,
  disposed_date date,
  tracking_start_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assets_type_chk check (asset_type in ('property', 'security', 'cash', 'other')),
  constraint assets_status_chk check (status in ('active', 'archived')),
  constraint assets_disposed_after_acquired_chk
    check (disposed_date is null or acquired_date is null or disposed_date >= acquired_date)
);
alter table public.assets add constraint assets_id_tenant_uk unique (id, tenant_id);
alter table public.assets
  add constraint assets_portfolio_tenant_fk
  foreign key (portfolio_id, tenant_id) references public.portfolios (id, tenant_id);

create table public.property_addresses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  line1 text not null,
  line2 text,
  suburb text not null,
  state_region text not null,
  postcode text not null,
  country_code char(2) not null default 'AU',
  normalized_address text,
  created_at timestamptz not null default now()
);
alter table public.property_addresses add constraint property_addresses_id_tenant_uk unique (id, tenant_id);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  asset_id uuid not null unique references public.assets (id) on delete cascade,
  address_id uuid references public.property_addresses (id),
  property_type text not null default 'residential',
  settlement_date date,
  purchase_price numeric(19, 4),
  currency char(3) not null default 'AUD',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_purchase_price_chk check (purchase_price is null or purchase_price > 0)
);
alter table public.properties
  add constraint properties_asset_tenant_fk
  foreign key (asset_id, tenant_id) references public.assets (id, tenant_id);
alter table public.properties
  add constraint properties_address_tenant_fk
  foreign key (address_id, tenant_id) references public.property_addresses (id, tenant_id);

create table public.asset_ownerships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  owner_id uuid not null references public.owners (id) on delete cascade,
  ownership_fraction numeric(12, 8) not null,
  effective_from date not null default current_date,
  effective_to date,
  source text not null default 'user_entered',
  created_at timestamptz not null default now(),
  constraint asset_ownerships_fraction_chk check (ownership_fraction > 0 and ownership_fraction <= 1),
  constraint asset_ownerships_effective_chk check (effective_to is null or effective_to >= effective_from)
);
alter table public.asset_ownerships
  add constraint asset_ownerships_asset_tenant_fk
  foreign key (asset_id, tenant_id) references public.assets (id, tenant_id);
alter table public.asset_ownerships
  add constraint asset_ownerships_owner_tenant_fk
  foreign key (owner_id, tenant_id) references public.owners (id, tenant_id);
