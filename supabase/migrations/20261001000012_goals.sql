-- 0012_goals.sql
-- Physical Schema/RLS v0.1, Section 10.
-- Exactly one scope field set, mirroring the DM-17 "exactly one of" pattern.

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  owner_id uuid references public.owners (id),
  household_id uuid references public.households (id),
  portfolio_id uuid references public.portfolios (id),
  goal_type text not null,
  target_amount numeric(19, 4) not null,
  currency char(3) not null default 'AUD',
  target_date date,
  target_age integer,
  status text not null default 'active',
  assumptions jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_target_amount_chk check (target_amount >= 0),
  constraint goals_status_chk check (status in ('active', 'achieved', 'abandoned')),
  constraint goals_scope_chk check (num_nonnulls(owner_id, household_id, portfolio_id) = 1)
);
alter table public.goals
  add constraint goals_owner_tenant_fk
  foreign key (owner_id, tenant_id) references public.owners (id, tenant_id);
alter table public.goals
  add constraint goals_household_tenant_fk
  foreign key (household_id, tenant_id) references public.households (id, tenant_id);
alter table public.goals
  add constraint goals_portfolio_tenant_fk
  foreign key (portfolio_id, tenant_id) references public.portfolios (id, tenant_id);
