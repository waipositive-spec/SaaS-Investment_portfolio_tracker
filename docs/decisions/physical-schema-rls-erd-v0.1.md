# Investment Portfolio Tracking & Management SaaS
## Physical PostgreSQL / Supabase Schema, RLS & Mermaid ERD — v0.1

**Status note (3 Oct 2026):** reviewed and extended. One significant gap found and fixed here: **there was no `leads` table and no anonymous-access path anywhere in the schema or RLS design**, even though the Lead entity (DM-17/19), the CRM adapter (ADR-021) and the public assessment endpoint (ADR-022, FR-85/86) have all been locked in since the domain model and architecture passes. As drafted, this schema could not actually run the free, pre-signup assessment flow — `property_assessments` required a `tenant_id`, and a tenant only exists after signup. Also missing: `assets.tracking_start_date` (the FR-25 decision) and the `property_assessments` created-by-lead-or-user split with its DM-17 check constraint, which the domain model's own physical-design guidance explicitly called for. All three are added below. See `dev-review-physical-schema-v0.1.md` for the full review.

| Control | Value |
| --- | --- |
| Version / Date | v0.1 / 3 October 2026 |
| Target | PostgreSQL 15+; Supabase Auth, PostgreSQL and private Storage |
| Parents | SRS v0.3; Domain Model/ERD v0.2; Calculation Spec v0.1; Architecture/ADRs v0.1 |
| Purpose | Implementation-ready tables, types, constraints, indexes, tenant/RLS model, storage rules and migration sequence. |

## 1. Physical Conventions

| Concern | Baseline |
| --- | --- |
| Keys | uuid DEFAULT gen_random_uuid(). |
| Tenant | tenant_id NOT NULL on customer-owned high-risk/query-heavy rows. **Exception: `leads` (no tenant_id ever) and `property_assessments` (nullable until the owning Lead converts — see Section 9a).** |
| Money | numeric(19,4); currency char(3). |
| Rates/fractions | numeric(12,8); fractions/rates stored as decimal. |
| Time | timestamptz for system time; date for business effective dates. |
| Business enums | text + CHECK/lookup unless exceptionally stable. |
| JSONB | Only extension/provider/audit metadata; not core finance. |
| Auth | user_profiles.id -> auth.users(id); Owner remains separate. |
| RLS | Policies derive access from auth.uid() membership, never client tenant claims. **`leads` is the deliberate exception — see Section 9a; it has RLS enabled with no anon/authenticated policies, so all access is service-role/server-mediated only.** |
| Secrets | service role/API secrets server-side only. |

## 2. RLS Helpers

```sql
create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists (
  select 1 from public.tenant_memberships tm
  where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid()
    and tm.status='active'
 );
$$;

create or replace function public.has_tenant_role(p_tenant_id uuid,p_roles text[])
returns boolean language sql stable security definer set search_path=public as $$
 select exists (
  select 1 from public.tenant_memberships tm
  where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid()
    and tm.status='active' and tm.role=any(p_roles)
 );
$$;
```

Security-definer ownership/grants must be tightly controlled and search_path fixed.

Tenant bootstrap/membership invitation is a trusted server/database workflow; users cannot self-enrol into arbitrary tenants.

## 3. Identity & Tenancy

| Table | Columns / Types | Constraints / Notes |
| --- | --- | --- |
| tenants | id uuid PK; name text; status text='active'; created_at/updated_at timestamptz | name NOT NULL; status active/suspended/closed. |
| user_profiles | id uuid PK/FK auth.users ON DELETE CASCADE; display_name text; created_at/updated_at | One profile per auth identity. |
| tenant_memberships | id uuid PK; tenant_id FK; user_id FK auth.users; role text; status text; joined_at | UNIQUE(tenant_id,user_id); roles owner/admin/member/viewer; indexes user/status and tenant/status. |

## 3a. Marketing / Lead Capture *(new)*

| Table | Columns / Types | Constraints / Notes |
| --- | --- | --- |
| leads | id uuid PK; email text; name text NULL; phone text NULL; consent_captured_at timestamptz; consent_type text; crm_provider text NULL; crm_external_id text NULL; crm_sync_status text='pending'; converted_user_id uuid NULL FK user_profiles(id); converted_at timestamptz NULL; created_at timestamptz | **No tenant_id — a Lead is explicitly not tenant-owned data (DM-19).** `consent_type` in (account_necessary, marketing); never inferred, must be explicitly set per submission (FR-86). `crm_sync_status` in (pending, synced, failed). UNIQUE partial index on lower(email) where converted_user_id is null, to avoid duplicate open leads for the same prospect — a converted lead's email may legitimately reappear. Index on crm_sync_status for the retry job (ADR-021). |

RLS: `alter table public.leads enable row level security;` with **no policies created for `anon` or `authenticated` roles** — every read/write to `leads` goes through a server route using the service role (mirrors ADR-022: the public assessment endpoint is server-mediated, not a direct client-to-table insert). This keeps the "no client-supplied tenant claims" RLS principle intact by simply never exposing the table to client roles at all.

## 4. Investor & Household

| Table | Columns / Types | Constraints / Notes |
| --- | --- | --- |
| owners | id; tenant_id; owner_type; display_name; date_of_birth date NULL; status; timestamps | owner_type person/company/trust/other; never store age. |
| households | id; tenant_id; name; status; timestamps | Tenant-scoped. |
| household_members | id; tenant_id; household_id; owner_id; role; effective_from; effective_to | effective_to NULL or >= from; index household/owner effective dates. |

## 5. Portfolio & Property

| Table | Columns / Types | Constraints / Notes |
| --- | --- | --- |
| portfolios | id; tenant_id; name; base_currency char(3)='AUD'; portfolio_type; status; timestamps | Index tenant/status. |
| assets | id; tenant_id; portfolio_id; asset_type; display_name; status; acquired_date; disposed_date; **tracking_start_date date NOT NULL DEFAULT current_date**; timestamps | asset_type property/security/cash/other; disposed >= acquired. **`tracking_start_date` resolves the FR-25 decision — periods before it are "not tracked," never $0 (DM-18). Defaults to today; user may override earlier to backfill history. Distinct from acquired_date/settlement_date.** |
| property_addresses | id; tenant_id; line1/line2; suburb; state_region; postcode; country_code='AU'; normalized_address; created_at | Do not assume address globally unique. |
| properties | id; tenant_id; asset_id UNIQUE; address_id; property_type; settlement_date; purchase_price numeric(19,4); currency; notes; timestamps | purchase_price >0 if present; asset must be property. |
| asset_ownerships | id; tenant_id; asset_id; owner_id; ownership_fraction numeric(12,8); effective_from/to; source; created_at | 0<fraction<=1; total active ownership validated transactionally; retain history. |

## 6. Valuation

| Table | Columns / Types | Constraints / Notes |
| --- | --- | --- |
| valuation_sources | id; tenant_id NULL; provider_code/name; source_type; created_at | Supports controlled global or tenant-specific sources. |
| valuations | id; tenant_id; asset_id; source_id; amount numeric(19,4); currency; valuation_type; classification; effective_at; recorded_at; low/high; confidence; external_reference; provider_metadata jsonb | amount>=0; confidence 0..1; indexes asset/effective DESC and tenant/recorded. |
| valuation_selections | id; tenant_id; asset_id UNIQUE; valuation_id; selected_at; selected_by; reason | One reporting selection per asset; same-tenant/asset validation. |

## 7. Liabilities

| Table | Columns / Types | Constraints / Notes |
| --- | --- | --- |
| loans | id; tenant_id; asset_id; lender_name; loan_name; original_principal; currency; start_date; repayment_type; rate_type; term_months; status; timestamps | principal>=0; term>0; indexes asset/status. |
| loan_balance_snapshots | id; tenant_id; loan_id; balance; offset_balance; effective_date; recorded_at; source; classification | balances>=0; index loan/effective DESC. |
| loan_rate_periods | id; tenant_id; loan_id; annual_rate numeric(12,8); effective_from/to; rate_type; source | rate>=0; effective_to>=from. |

## 8. Ledger & Evidence

| Table | Columns / Types | Constraints / Notes |
| --- | --- | --- |
| transaction_categories | id; tenant_id NULL; code; name; category_group; active; tax_mapping; sort_order | group income/operating_expense/finance/principal/capital_expenditure/transfer/other. |
| transactions | id; tenant_id; asset_id; transaction_date; amount numeric(19,4); currency; direction; category_id; description; counterparty; external_reference; source; classification='actual'; review_status; created_by; timestamps; archived_at | amount>0; direction income/expense/transfer_in/transfer_out; indexes asset/date, tenant/date, category/date. Application layer must reject transaction_date earlier than the asset's tracking_start_date through normal entry flows (DM-18) — not a DB CHECK, since backfill corrections are a legitimate trusted-workflow exception. |
| evidence_documents *(MVP1: table exists; no upload UI until MVP2)* | id; tenant_id; storage_bucket/path; original_filename; mime_type; file_size_bytes; content_hash_sha256; uploaded_at/by; source; status | size>0; UNIQUE tenant/bucket/path; index tenant/hash. |
| transaction_evidence *(MVP1: table exists; no UI until MVP2)* | id; tenant_id; transaction_id; document_id; relationship_type; linked_at/by | UNIQUE(transaction_id,document_id); M:N evidence mapping. |

## 9. Property Assessment

| Table | Columns / Types | Constraints / Notes |
| --- | --- | --- |
| property_assessments | id; **tenant_id NULL**; **created_by_lead_id uuid NULL FK leads(id)**; **created_by_user_id uuid NULL FK user_profiles(id)**; address_id NULL; title; asking_price; currency; status; timestamps; archived_at | status draft/active/archived/promoted; never part of portfolio totals. **CHECK (num_nonnulls(created_by_lead_id, created_by_user_id) = 1) — exactly one of Lead/UserAccount, per DM-17.** `tenant_id` is set only once the assessment belongs to an authenticated tenant (directly if `created_by_user_id`, or on conversion if it started as `created_by_lead_id`); NULL while Lead-owned and pre-conversion. |
| assessment_scenarios | id; tenant_id; assessment_id; name; is_baseline; proposed_purchase_price; estimated_rent_amount; rent_frequency; vacancy_rate; proposed_loan; interest_rate; loan_term_months; repayment_type/frequency; acquisition_costs; immediate_works; timestamps | vacancy 0..1; money/rates >=0; partial UNIQUE one baseline per assessment. *(Already typed rather than EAV — this directly implements the Calculation Specification's recommendation to move the stable FR-79 input list off generic assumption storage; no further action needed here.)* |
| assessment_expense_items | id; tenant_id; scenario_id; expense_type; amount; frequency; notes | Typed expense rows; amount>=0. |
| assessment_promotions | id; tenant_id; assessment_id UNIQUE; asset_id UNIQUE; promoted_at/by | Promotion link only; assumptions do not become actual. **Requires `property_assessments.tenant_id` to be non-null at promotion time — i.e. a Lead-owned assessment must convert first (consistent with the domain model's AssessmentPromotion rule).** |

**On conversion** (Lead signs up): set `leads.converted_user_id`/`converted_at`; for every `property_assessments` row with that `created_by_lead_id`, set `tenant_id` to the new tenant and `created_by_user_id` to the new user — `created_by_lead_id` is retained, not cleared, for traceability (mirrors DM-17's "transfers... never duplicated").

## 10. Goals, Audit & Reporting

| Table | Columns / Types | Constraints / Notes |
| --- | --- | --- |
| goals | id; tenant_id; owner_id/household_id/portfolio_id nullable scope; goal_type; target_amount; currency; target_date; target_age; status; assumptions jsonb; timestamps | Scope rule/check; target>=0. |
| audit_events | id; tenant_id; actor_user_id; entity_type; entity_id; action; occurred_at; correlation_id; change_set jsonb; metadata jsonb | Append-only to ordinary roles; entity-history index. |
| report_runs *(MVP1: table exists; no UI until MVP2)* | id; tenant_id; report_type; asset_id; period_start/end; calculation_version; generated_by/at; status; parameters/source_snapshot_metadata jsonb | Metadata/output provenance; ledger remains source. |
| export_artifacts *(MVP1: table exists; no UI until MVP2)* | id; tenant_id; report_run_id; storage_bucket/path; mime_type; content_hash_sha256; created_at | Private storage; unique tenant/path. |

## 11. Cross-Tenant Referential Integrity

Prefer composite tenant-aware foreign keys for sensitive relationships: parent UNIQUE(id,tenant_id), then child FOREIGN KEY(parent_id,tenant_id) REFERENCES parent(id,tenant_id). This makes a cross-tenant relationship impossible even if application code is defective.

```sql
alter table public.assets add constraint assets_id_tenant_uk unique(id,tenant_id);
alter table public.transactions
 add constraint transactions_asset_tenant_fk
 foreign key(asset_id,tenant_id) references public.assets(id,tenant_id);
```

`property_assessments` is a deliberate exception while `tenant_id` is nullable (Lead-owned, pre-conversion) — the composite tenant-aware FK pattern applies to its children (`assessment_scenarios`, `assessment_expense_items`, `assessment_promotions`) only once `tenant_id` is set; enforce via application transaction at conversion time rather than a DB constraint that would reject the nullable pre-conversion state.

## 12. RLS Policy Pattern

```sql
alter table public.transactions enable row level security;

create policy transactions_select on public.transactions for select
 using (public.is_tenant_member(tenant_id));

create policy transactions_insert on public.transactions for insert
 with check (public.is_tenant_member(tenant_id));

create policy transactions_update on public.transactions for update
 using (public.is_tenant_member(tenant_id))
 with check (public.is_tenant_member(tenant_id));

-- ordinary client roles receive no destructive DELETE policy for accounting history
```

| Policy Class | Rule |
| --- | --- |
| Standard tenant tables | owners, households, household_members, portfolios, assets, property_addresses, properties, asset_ownerships, valuations, valuation_selections, loans, loan_balance_snapshots, loan_rate_periods, transactions, evidence_documents, transaction_evidence, goals, audit_events, report_runs, export_artifacts: SELECT for active member; mutation according to role/workflow; archive rather than destructive delete where financial history applies. |
| property_assessments / assessment_scenarios / assessment_expense_items / assessment_promotions *(revised)* | Authenticated tenant member: standard tenant-member SELECT/mutation as above, but only once `tenant_id` is set. **While `tenant_id` is NULL (Lead-owned, pre-conversion), there is no client-role policy at all — all access goes through the server's service-role-mediated assessment API**, the same pattern as `leads`. |
| leads *(new)* | No `anon`/`authenticated` policy — service-role/server-mediated only (Section 3a). |
| tenant_memberships | Visibility as product requires; owner/admin/trusted workflows mutate. |
| valuation_sources / transaction_categories | Read approved global rows (tenant_id NULL) plus own tenant rows; global writes service/admin only. |
| user_profiles | User reads/updates own profile; trusted onboarding creates. |
| audit_events | Read as authorised; inserts trusted application/database path; no ordinary update/delete. |

## 13. Supabase Storage

Private bucket `accounting-evidence`; optional separate private report-export bucket.

Path convention `<tenant_id>/<document_id>/<opaque-or-sanitised-name>`.

Do not authorise solely from path. Confirm membership against DB metadata/tenant.

Prefer short-lived signed upload/download URLs mediated by server.

Validate MIME/size/content server-side; add malware scanning before broad public exposure.

Compute/store SHA-256 digest; duplicate hash is a warning, not automatic deletion.

Never expose service-role key in browser.

## 14. Index Baseline

| Use | Index |
| --- | --- |
| RLS membership | tenant_memberships(user_id,status,tenant_id); tenant_memberships(tenant_id,user_id,status) |
| Dashboard assets | assets(tenant_id,portfolio_id,status) |
| Latest valuation | valuations(asset_id,effective_at DESC) |
| Latest debt | loan_balance_snapshots(loan_id,effective_date DESC) |
| FY ledger | transactions(asset_id,transaction_date DESC) |
| Tenant ledger | transactions(tenant_id,transaction_date DESC) |
| Category reporting | transactions(category_id,transaction_date) |
| Evidence duplicate | evidence_documents(tenant_id,content_hash_sha256) |
| Assessment list | property_assessments(tenant_id,status,updated_at DESC) |
| Lead assessment list *(new)* | property_assessments(created_by_lead_id,status,updated_at DESC) |
| Lead lookup/dedupe *(new)* | leads(lower(email)); leads(crm_sync_status) |
| Audit history | audit_events(tenant_id,entity_type,entity_id,occurred_at DESC) |

## 15. Transaction & Concurrency Rules

| Operation | Rule |
| --- | --- |
| Tenant bootstrap | Create tenant + initial owner membership atomically through trusted function/service. |
| Lead conversion *(new)* | Set leads.converted_user_id/converted_at + reattach owned property_assessments (tenant_id, created_by_user_id) atomically in the same transaction as tenant bootstrap. |
| Assessment promotion | Atomic Asset/Property + AssessmentPromotion; assumptions remain assumptions; requires tenant_id already set (post-conversion). |
| Ownership change | Validate effective overlaps and resulting total before commit. |
| Valuation selection | Selection + same-asset/same-tenant validation atomic. |
| Transaction correction | Correction/archive + audit event in same transaction where feasible. |
| EOY report | Read consistent snapshot; stamp calculation version/source metadata. |
| Provider ingestion | Idempotency/external-reference logic prevents duplicate retry observations. |
| CRM sync *(new)* | Lead write commits regardless of CRM reachability; crm_sync_status set to 'pending'/'failed' and retried out-of-band — never block or roll back the Lead save on CRM failure (per architecture ADR-021/failure-mode table). |

## 16. Migration Order

| Migration | Content |
| --- | --- |
| 0001_extensions | pgcrypto/gen_random_uuid and approved extensions. |
| 0002_identity | user_profiles, tenants, tenant_memberships, trusted bootstrap. |
| 0003_rls_helpers | Membership/role helper functions and grants. |
| 0004_marketing *(new, renumbered — was 0004_investor)* | leads table; RLS enabled with no client policies. |
| 0005_investor | owners, households, household_members. |
| 0006_portfolio_core | portfolios, assets (incl. tracking_start_date), property_addresses, properties, asset_ownerships. |
| 0007_valuation | valuation_sources, valuations, valuation_selections. |
| 0008_liabilities | loans, balance snapshots, rate periods. |
| 0009_ledger | transaction_categories + safe seed rows, transactions. |
| 0010_evidence | evidence metadata/links; private storage configuration. *(MVP1: schema only)* |
| 0011_assessment | assessments (incl. created_by_lead_id/created_by_user_id + DM-17 check), scenarios, expense items, promotions. |
| 0012_goals | goals. |
| 0013_audit_reporting | audit events, report runs, export artifacts. *(report_runs/export_artifacts: MVP1 schema only)* |
| 0014_tenant_integrity | Composite unique/FKs or approved tenant constraint triggers. |
| 0015_indexes | Indexes + partial unique baseline-scenario index + Lead/assessment indexes. |
| 0016_rls | Enable RLS, policies, revoke unsafe defaults. |
| 0017_views_functions | RLS-safe current/reporting views/functions. |
| 0018_reference_seed | Versioned reference/category data. |
| 0019_verification | CI integration verification against clean migration. |

## 17. Verification Gates

| ID | Test |
| --- | --- |
| DBV-01 | Tenant A cannot SELECT/INSERT/UPDATE Tenant B rows using authenticated client credentials. |
| DBV-02 | Cross-tenant FK relationship fails even when both UUIDs are known. |
| DBV-03 | Ordinary client cannot mutate/delete audit history. |
| DBV-04 | New valuation preserves previous valuations. |
| DBV-05 | New loan snapshot preserves balance history. |
| DBV-06 | Assessment does not enter portfolio aggregation before promotion. |
| DBV-07 | Promotion creates no actual rent from estimated rent. |
| DBV-08 | Required transaction amount NULL/zero fails; unknown optional values remain NULL. |
| DBV-09 | Evidence cannot be fetched without authorised tenant access. |
| DBV-10 | FY ledger includes only qualifying actual period/property transactions and reconciles to report. |
| DBV-11 | At most one baseline scenario per assessment. |
| DBV-12 | Restore exercise reconstructs relational data/document metadata; storage recovery separately verified. |
| DBV-13 *(new)* | An unauthenticated (anon-role) client can insert a Lead and a Lead-owned property_assessment within configured free-tier limits, but cannot SELECT/INSERT/UPDATE any row in any tenant-scoped table, and cannot read another Lead's data. |
| DBV-14 *(new)* | property_assessments insert/update fails if both or neither of created_by_lead_id/created_by_user_id are set (DM-17 check constraint). |
| DBV-15 *(new)* | Lead conversion reattaches all of that Lead's property_assessments to the new tenant in one transaction; no assessment is left orphaned or duplicated. |

## 18. Mermaid ERD Source

```
erDiagram
 AUTH_USERS ||--|| USER_PROFILES : has
 AUTH_USERS ||--o{ TENANT_MEMBERSHIPS : joins
 TENANTS ||--o{ TENANT_MEMBERSHIPS : contains
 TENANTS ||--o{ OWNERS : owns
 TENANTS ||--o{ HOUSEHOLDS : owns
 HOUSEHOLDS ||--o{ HOUSEHOLD_MEMBERS : contains
 OWNERS ||--o{ HOUSEHOLD_MEMBERS : participates
 TENANTS ||--o{ PORTFOLIOS : owns
 PORTFOLIOS ||--o{ ASSETS : contains
 ASSETS ||--o| PROPERTIES : specializes
 PROPERTY_ADDRESSES ||--o{ PROPERTIES : locates
 ASSETS ||--o{ ASSET_OWNERSHIPS : has
 OWNERS ||--o{ ASSET_OWNERSHIPS : holds
 ASSETS ||--o{ VALUATIONS : valued_by
 VALUATION_SOURCES ||--o{ VALUATIONS : sources
 ASSETS ||--o| VALUATION_SELECTIONS : has
 VALUATIONS ||--o{ VALUATION_SELECTIONS : selected
 ASSETS ||--o{ LOANS : secures
 LOANS ||--o{ LOAN_BALANCE_SNAPSHOTS : snapshots
 LOANS ||--o{ LOAN_RATE_PERIODS : rates
 ASSETS ||--o{ TRANSACTIONS : posts
 TRANSACTION_CATEGORIES ||--o{ TRANSACTIONS : classifies
 TRANSACTIONS ||--o{ TRANSACTION_EVIDENCE : supported_by
 EVIDENCE_DOCUMENTS ||--o{ TRANSACTION_EVIDENCE : supports
 LEADS ||--o{ PROPERTY_ASSESSMENTS : creates_pre_signup
 USER_PROFILES ||--o{ PROPERTY_ASSESSMENTS : creates_authenticated
 LEADS ||--o| USER_PROFILES : converts_to
 TENANTS ||--o{ PROPERTY_ASSESSMENTS : owns_post_signup
 PROPERTY_ADDRESSES ||--o{ PROPERTY_ASSESSMENTS : identifies
 PROPERTY_ASSESSMENTS ||--o{ ASSESSMENT_SCENARIOS : contains
 ASSESSMENT_SCENARIOS ||--o{ ASSESSMENT_EXPENSE_ITEMS : estimates
 PROPERTY_ASSESSMENTS ||--o| ASSESSMENT_PROMOTIONS : promotes
 ASSETS ||--o| ASSESSMENT_PROMOTIONS : created_as
 TENANTS ||--o{ GOALS : owns
 OWNERS ||--o{ GOALS : scopes
 HOUSEHOLDS ||--o{ GOALS : scopes
 PORTFOLIOS ||--o{ GOALS : scopes
 TENANTS ||--o{ AUDIT_EVENTS : records
 TENANTS ||--o{ REPORT_RUNS : generates
 REPORT_RUNS ||--o{ EXPORT_ARTIFACTS : produces
```

## 19. Claude Code Handoff

Implement only through ordered migrations. Before production DDL, expand each shorthand column set into exact CREATE TABLE statements, apply tenant-aware composite FKs consistently, generate explicit RLS policies per table, and test with two authenticated tenants plus one anon-role client. Generate TypeScript DB types after migrations; keep domain types separate from raw rows. Any divergence requires a superseding schema decision/ADR. The `leads` table and the pre-conversion `property_assessments` state (nullable tenant_id) are never exposed to client roles directly — every read/write goes through a server route using the service role.

---
*Investment Portfolio SaaS — PostgreSQL/Supabase Schema & RLS v0.1 | 3 Oct 2026 | Reviewed and extended 3 Oct 2026: leads table, tracking_start_date, property_assessments created-by-lead-or-user split (DM-17), renumbered migrations, DBV-13/14/15. See `dev-review-physical-schema-v0.1.md`.*
