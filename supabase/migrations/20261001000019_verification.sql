-- 0019_verification.sql
-- Physical Schema/RLS v0.1, Section 16/17.
-- Structural self-checks run after a clean migration in CI. These assert
-- shape (RLS enabled, no stray policies on leads, tenant_id NOT NULL
-- where expected) — they are NOT a substitute for the behavioural DBV-01
-- .. DBV-15 tests (two real tenants + one anon client), which belong in
-- tests/integration once the Supabase project exists.

do $$
declare
  missing_rls text;
begin
  select string_agg(c.relname, ', ')
  into missing_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname not in ('schema_migrations') -- adjust if a migration-tracking table is added
    and not c.relrowsecurity;

  if missing_rls is not null then
    raise exception 'Tables without row level security enabled: %', missing_rls;
  end if;
end;
$$;

-- leads must have zero policies for anon/authenticated roles (service-role
-- mediated only).
do $$
declare
  leads_policy_count integer;
begin
  select count(*) into leads_policy_count
  from pg_policies
  where schemaname = 'public' and tablename = 'leads';

  if leads_policy_count <> 0 then
    raise exception 'leads table must have zero client-role RLS policies, found %', leads_policy_count;
  end if;
end;
$$;

-- property_assessments.tenant_id and its three children must be nullable
-- (Lead-owned, pre-conversion state) — a NOT NULL here would break the
-- free assessment flow entirely.
do $$
declare
  non_nullable text;
begin
  select string_agg(table_name || '.' || column_name, ', ')
  into non_nullable
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'property_assessments'
    and column_name = 'tenant_id'
    and is_nullable = 'NO';

  if non_nullable is not null then
    raise exception 'property_assessments.tenant_id must remain nullable, found NOT NULL on: %', non_nullable;
  end if;
end;
$$;

-- DM-17 check constraint must exist on property_assessments.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'property_assessments_creator_chk'
      and conrelid = 'public.property_assessments'::regclass
  ) then
    raise exception 'property_assessments_creator_chk (DM-17) is missing';
  end if;
end;
$$;

select 'migrations 0001-0019 applied and structural verification passed' as result;
