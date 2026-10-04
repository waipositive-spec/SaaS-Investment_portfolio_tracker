-- 0005_investor.sql
-- Physical Schema/RLS v0.1, Section 4.

create table public.owners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  owner_type text not null,
  display_name text not null,
  date_of_birth date,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owners_type_chk check (owner_type in ('person', 'company', 'trust', 'other')),
  constraint owners_status_chk check (status in ('active', 'archived'))
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint households_status_chk check (status in ('active', 'archived'))
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id uuid not null references public.owners (id) on delete cascade,
  role text not null,
  effective_from date not null default current_date,
  effective_to date,
  constraint household_members_effective_chk check (effective_to is null or effective_to >= effective_from)
);

create index household_members_household_effective_idx
  on public.household_members (household_id, effective_from, effective_to);
create index household_members_owner_effective_idx
  on public.household_members (owner_id, effective_from, effective_to);

alter table public.owners add constraint owners_id_tenant_uk unique (id, tenant_id);
alter table public.households add constraint households_id_tenant_uk unique (id, tenant_id);

alter table public.household_members
  add constraint household_members_household_tenant_fk
  foreign key (household_id, tenant_id) references public.households (id, tenant_id);
alter table public.household_members
  add constraint household_members_owner_tenant_fk
  foreign key (owner_id, tenant_id) references public.owners (id, tenant_id);
