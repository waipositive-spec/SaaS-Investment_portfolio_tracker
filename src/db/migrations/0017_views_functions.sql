-- 0017_views_functions.sql
-- Physical Schema/RLS v0.1, Section 12.
-- RLS-safe convenience views used by the Portfolio/Valuation/Liability
-- read contracts (API Contracts Sections 5-7). Views run with the
-- querying role's own privileges (not security definer), so the
-- underlying tables' RLS policies still apply to every row returned.

-- Latest selected valuation per asset.
create or replace view public.current_valuations as
select
  vs.asset_id,
  vs.tenant_id,
  v.amount,
  v.currency,
  v.classification,
  v.effective_at,
  vs.selected_at
from public.valuation_selections vs
join public.valuations v on v.id = vs.valuation_id;

-- Latest loan balance snapshot per loan (by effective_date, tie-broken by
-- most recently recorded).
create or replace view public.current_loan_balances as
select distinct on (lbs.loan_id)
  lbs.loan_id,
  lbs.tenant_id,
  lbs.balance,
  lbs.offset_balance,
  lbs.effective_date,
  lbs.recorded_at
from public.loan_balance_snapshots lbs
order by lbs.loan_id, lbs.effective_date desc, lbs.recorded_at desc;
