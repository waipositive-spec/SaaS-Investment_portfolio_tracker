-- 0002_identity.sql
-- Physical Schema/RLS v0.1, Section 3.
-- tenants, user_profiles, tenant_memberships + trusted bootstrap function.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_status_chk check (status in ('active', 'suspended', 'closed'))
);

create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  status text not null default 'active',
  joined_at timestamptz not null default now(),
  constraint tenant_memberships_tenant_user_uk unique (tenant_id, user_id),
  constraint tenant_memberships_role_chk check (role in ('owner', 'admin', 'member', 'viewer')),
  constraint tenant_memberships_status_chk check (status in ('active', 'invited', 'suspended', 'removed'))
);

create index tenant_memberships_user_status_tenant_idx
  on public.tenant_memberships (user_id, status, tenant_id);
create index tenant_memberships_tenant_user_status_idx
  on public.tenant_memberships (tenant_id, user_id, status);

-- Trusted server-side tenant bootstrap: creates a tenant, a user_profile row
-- (if absent) and the initial 'owner' membership atomically. Called from the
-- bootstrapTenant application-service contract (API Contracts Section 2),
-- never directly callable by a client role.
create or replace function public.bootstrap_tenant(p_user_id uuid, p_display_name text, p_tenant_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  insert into public.user_profiles (id, display_name)
  values (p_user_id, p_display_name)
  on conflict (id) do update set display_name = excluded.display_name, updated_at = now();

  insert into public.tenants (name) values (p_tenant_name)
  returning id into v_tenant_id;

  insert into public.tenant_memberships (tenant_id, user_id, role, status)
  values (v_tenant_id, p_user_id, 'owner', 'active');

  return v_tenant_id;
end;
$$;

revoke all on function public.bootstrap_tenant(uuid, text, text) from public;
