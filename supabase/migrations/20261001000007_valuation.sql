-- 0007_valuation.sql
-- Physical Schema/RLS v0.1, Section 6.
-- Valuations are append-only observations (ADR-009/DBV-04); current value
-- is always derived via valuation_selections, never an overwritten field.

create table public.valuation_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  provider_code text not null,
  provider_name text not null,
  source_type text not null default 'provider',
  created_at timestamptz not null default now()
);

create table public.valuations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  source_id uuid references public.valuation_sources (id),
  amount numeric(19, 4) not null,
  currency char(3) not null default 'AUD',
  valuation_type text not null default 'estimate',
  classification text not null default 'estimate',
  effective_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  low numeric(19, 4),
  high numeric(19, 4),
  confidence numeric(4, 3),
  external_reference text,
  provider_metadata jsonb,
  constraint valuations_amount_chk check (amount >= 0),
  constraint valuations_confidence_chk check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint valuations_classification_chk
    check (classification in ('actual', 'estimate', 'calculated', 'forecast', 'formal_external_valuation'))
);
create index valuations_asset_effective_idx on public.valuations (asset_id, effective_at desc);
create index valuations_tenant_recorded_idx on public.valuations (tenant_id, recorded_at desc);
alter table public.valuations
  add constraint valuations_asset_tenant_fk
  foreign key (asset_id, tenant_id) references public.assets (id, tenant_id);
alter table public.valuations add constraint valuations_id_tenant_uk unique (id, tenant_id);

create table public.valuation_selections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  asset_id uuid not null unique references public.assets (id) on delete cascade,
  valuation_id uuid not null references public.valuations (id),
  selected_at timestamptz not null default now(),
  selected_by uuid references public.user_profiles (id),
  reason text
);
alter table public.valuation_selections
  add constraint valuation_selections_asset_tenant_fk
  foreign key (asset_id, tenant_id) references public.assets (id, tenant_id);
alter table public.valuation_selections
  add constraint valuation_selections_valuation_tenant_fk
  foreign key (valuation_id, tenant_id) references public.valuations (id, tenant_id);
