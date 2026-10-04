-- 0018_reference_seed.sql
-- Physical Schema/RLS v0.1, Section 16.
-- Versioned, global (tenant_id null) reference categories backing the
-- CAL-010..016 live income/cash-flow calculations. Safe to re-run
-- (idempotent via ON CONFLICT).

insert into public.transaction_categories (tenant_id, code, name, category_group, sort_order)
values
  (null, 'rental_income', 'Rental income', 'income', 10),
  (null, 'other_income', 'Other income', 'income', 20),
  (null, 'property_management_fee', 'Property management fee', 'operating_expense', 30),
  (null, 'council_rates', 'Council rates', 'operating_expense', 40),
  (null, 'water_rates', 'Water rates', 'operating_expense', 50),
  (null, 'insurance', 'Landlord insurance', 'operating_expense', 60),
  (null, 'strata_body_corp', 'Strata / body corporate', 'operating_expense', 70),
  (null, 'repairs_maintenance', 'Repairs & maintenance', 'operating_expense', 80),
  (null, 'other_operating_expense', 'Other operating expense', 'operating_expense', 90),
  (null, 'loan_interest', 'Loan interest', 'finance', 100),
  (null, 'loan_principal', 'Loan principal repayment', 'principal', 110),
  (null, 'capital_improvement', 'Capital improvement', 'capital_expenditure', 120),
  (null, 'owner_contribution', 'Owner contribution (transfer in)', 'transfer', 130),
  (null, 'owner_drawdown', 'Owner drawdown (transfer out)', 'transfer', 140)
on conflict (code) where tenant_id is null do nothing;
