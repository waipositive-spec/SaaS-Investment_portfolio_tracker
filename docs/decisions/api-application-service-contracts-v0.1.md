# Investment Portfolio Tracking & Management SaaS
## API / Application-Service Contracts — v0.1

| Control | Value |
| --- | --- |
| Date | 3 October 2026 |
| Parents | SRS v0.3; Domain Model/ERD v0.2; Calculation Specification v0.1; Architecture/ADRs v0.1; Physical Schema/RLS v0.1 |
| Purpose | Fill the one gap left before Claude Code handoff: concrete request/response contracts for every application-service boundary named in the Architecture doc's module list (Section 4) and request-flow patterns (Section 5), so endpoint shapes don't have to be invented during implementation. |
| Status | Author: Claude, acting as Developer, deriving directly from the now-consistent Architecture/Domain Model/Calculation Spec/Physical Schema — not a user-authored source document, so there is no separate reconciliation doc; verification gates (Section 16) serve that role instead. |

## 1. Conventions

| Concern | Baseline |
| --- | --- |
| Transport | Authenticated mutations/queries: Next.js Server Actions (ADR-003), typed end-to-end, not versioned as public REST. The two endpoints reachable by an unauthenticated caller (Section 3) are real HTTP routes under `/api/public/v1/...` since they must be callable without a session, and are the only ones that need external versioning discipline. |
| Envelope | Every contract returns `{ ok: true, data: T }` or `{ ok: false, error: { code, message, field? } }`. Server Actions and public routes share this envelope so a future external API (ADR-001's "future mobile/API" driver) can reuse the same contracts. |
| Auth context | Every authenticated contract receives `{ userId, tenantId, role }` resolved server-side from the session + `tenant_memberships` — **never from a client-supplied tenant_id**, per ADR-007/NFR tenant isolation. A contract that accepts a `tenantId`-shaped parameter from the client is a defect. |
| Calculation diagnostics | Any contract that returns a CAL-xxx/ASM-xxx metric uses the Calculation Spec's diagnostic states verbatim: `OK`, `INCOMPLETE_INPUT`, `INVALID_INPUT`, `STALE_INPUT` — attached per-metric, not just once for the whole response, since one dashboard call can mix available and unavailable metrics. |
| Validation | Input validation (required fields, numeric ranges, enum membership) happens at the contract boundary before the domain/calculation service is invoked — the calculation services themselves (Calc Spec Section 14) assume already-validated typed input and must not re-validate. |
| Idempotency | Any contract backing a background job (valuation refresh, CRM sync retry, export generation) accepts/returns a job correlation id and is safe to retry (ADR-012/Physical Schema Section 15). |
| Error codes | A shared taxonomy, not per-endpoint strings: `UNAUTHENTICATED`, `UNAUTHORIZED` (tenant/role mismatch — never reveals whether the resource exists for another tenant, per AV-10/Architecture Section 10), `VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT` (e.g. ownership-percentage overlap, duplicate baseline scenario), `RATE_LIMITED` (public endpoint only), `UPSTREAM_UNAVAILABLE` (provider/CRM), `INTERNAL`. |
| Versioning | Public routes versioned in the path (`/api/public/v1/...`). Server Action contracts are versioned implicitly by the TypeScript types shipping with each deploy; a breaking shape change is a new Server Action name, not a silent signature change, so older deployed clients (if any exist by the time this matters) fail loudly rather than mis-parse. |

## 2. Authentication & Tenant Resolution Contract

| Operation | Trigger | Input | Output | Notes |
| --- | --- | --- | --- | --- |
| `resolveSession()` | Every authenticated Server Action calls this first, implicitly via middleware. | Session cookie (Supabase Auth). | `{ userId, tenantId, role }` for the active tenant, or `UNAUTHENTICATED`. | If a user belongs to multiple tenants (future collaboration), active tenant comes from an explicit `activeTenantId` in session state, never inferred from the first membership found. |
| `bootstrapTenant(input)` | Signup completion. | `{ displayName, convertingLeadId?: uuid }` | `{ tenantId, userId }` | Creates `tenants` + `user_profiles` + owner `tenant_memberships` row + (if `convertingLeadId` present) runs Lead conversion (Section 3) atomically, per Physical Schema Section 15's "Tenant bootstrap" + "Lead conversion" rule. |
| `inviteMember(input)` *(MVP1 if co-owner supported, else stub)* | Owner invites a partner/co-owner. | `{ email, role }` | `{ invitationId }` | Role initially owner/admin/member/viewer per Physical Schema Section 3; invitation accept flow out of scope for this contract pass. |

## 3. Marketing / Lead Capture Contracts (public, unauthenticated)

These are the two contracts on the public trust-boundary exception (ADR-022). Everything else in this document requires authentication.

| Operation | Route | Auth | Input | Output | Notes |
| --- | --- | --- | --- | --- | --- |
| `createLeadAssessment` | `POST /api/public/v1/assessments` | None (rate-limited, bot-resistant per AV-11/DBV-13) | `{ contact: { email, name?, phone? }, consent: { accountNecessary: true, marketing: boolean }, assessment: { title?, address?, askingPrice? } }` | `{ leadId, assessmentId }` or `RATE_LIMITED` | Creates `leads` row (consent_type recorded distinctly per field, FR-86 — `accountNecessary` is always required true, `marketing` is a genuine opt-in never defaulted true) + `property_assessments` row with `created_by_lead_id` set, `tenant_id` NULL. Triggers best-effort async CRM sync (Section 14) — **never blocks this response on CRM reachability** (Architecture failure-mode table). |
| `getLeadAssessment` | `GET /api/public/v1/assessments/:assessmentId` | A short-lived signed token issued at creation (emailed or kept in browser storage) — not a session, since there is no account yet. | `{ assessmentId }` + token | `{ assessment, scenarios, calculatedMetrics }` | Returns only that Lead's own assessment; token scope is a single assessment, not the Lead's full record, to limit blast radius if a token leaks. |
| `updateLeadAssessmentScenario` | `PATCH /api/public/v1/assessments/:assessmentId/scenarios/:scenarioId` | Same signed token. | Scenario fields (Section 4's `AssessmentScenarioInput`) | `{ scenario, calculatedMetrics }` | Reuses the identical validation + calculation path as the authenticated version (Section 4) — there is exactly one implementation of ASM-xxx, called from both the public and authenticated contracts (ADR-005). |
| `convertLead` *(internal, called by `bootstrapTenant`, not directly client-callable)* | — | Server-side only | `{ leadId, userId, tenantId }` | `void` | Sets `leads.converted_user_id/converted_at`; reattaches every `property_assessments` row with that `created_by_lead_id` to the new `tenant_id`/`created_by_user_id`, atomically (Physical Schema DBV-15). `created_by_lead_id` is retained, never cleared. |

Free-tier limits (FR-85) are enforced inside `createLeadAssessment`/`updateLeadAssessmentScenario` — e.g. a per-email or per-session cap on saved assessments/premium calculations — as configuration, not a schema constraint, so the limit can change without a migration.

## 4. Property Assessment Contracts (authenticated)

| Operation | Trigger | Input | Output | Notes |
| --- | --- | --- | --- | --- |
| `createAssessment` | "New assessment" (authenticated user, no Lead involved). | `{ title?, address? }` | `{ assessmentId }` | `created_by_user_id` set directly; `tenant_id` set from session immediately (no Lead step). |
| `listAssessments` | Assessment dashboard. | `{ status?: filter }` | `{ assessments: [{ id, title, status, updatedAt }] }` | Tenant-scoped via RLS; never includes another tenant's or an unconverted Lead's assessments. |
| `upsertAssessmentScenario` | Editing a scenario. | `AssessmentScenarioInput = { assessmentId, scenarioId?, name, isBaseline, proposedPurchasePrice?, askingPrice?, estimatedRent?: {amount, frequency}, vacancyRate?, proposedLoan?, interestRate?, loanTermMonths?, repaymentType?, repaymentFrequency?, acquisitionCosts?, immediateWorks?, expenseItems?: [{expenseType, amount, frequency}] }` | `{ scenario, calculatedMetrics: AsmMetricsResult }` | `AsmMetricsResult` is a map of ASM-001…ASM-017 → `{ value: number \| null, diagnostic: 'OK'\|'INCOMPLETE_INPUT'\|'INVALID_INPUT', missingInputs?: string[] }`, computed via the single canonical ASM calculation service (ADR-005) — identical code path to Section 3's public contract. Violates CD-04/CD-05/missing-data rules (Calc Spec Section 10) → `VALIDATION_FAILED` for hard rejects (vacancy outside 0–100%, rate <0, term ≤0), `INCOMPLETE_INPUT` diagnostic (not an error) for merely-missing optional inputs. Enforces "one baseline per assessment" (DBV-11) → `CONFLICT` on violation. |
| `archiveAssessment` | User archives a prospect they didn't pursue. | `{ assessmentId }` | `{ assessment }` | Sets `archived_at`; never deletes (ADR-016 soft-history preference); has zero portfolio-total effect either way (DM-08, AV-04/DBV-06). |
| `promoteAssessment` | "Add to Portfolio" button. | `{ assessmentId, scenarioId, confirmedAcquisition: { purchasePrice, settlementDate, ownerships: [{ownerId, fraction}] }, confirmedLoan?: {...}, trackingStartDate? }` | `{ assetId, propertyId, promotionId }` | Requires `property_assessments.tenant_id` already set (post-conversion if it started as Lead-owned) — `UNAUTHORIZED` if attempted while still Lead-owned/unconverted. Creates `assets`/`properties`/`asset_ownerships`/`assessment_promotions` atomically (Physical Schema Section 15). **Does not copy `askingPrice`/`estimatedRent`/proposed loan terms into actual fields** — the caller must separately supply `confirmedAcquisition`/`confirmedLoan` as genuinely-entered actuals (AV-05/DM-09/CP-05). `trackingStartDate` defaults to today if omitted (FR-25 rule), may be backdated by the user. |

## 5. Portfolio Core Contracts (authenticated) — standard CRUD template

The Owner, Household, Portfolio, Asset and Property entities share one contract shape; listed once rather than per-entity to keep this usable.

| Operation pattern | Input | Output | Notes |
| --- | --- | --- | --- |
| `create<Entity>` | Entity-specific typed fields (see Domain Model Section 5 for the field list per entity) — never `tenantId` (resolved server-side). | `{ id, ...entity }` | `Asset.tracking_start_date` defaults to today unless explicitly backdated (FR-25). `Property` creation requires an existing `Asset` of type `property` (DM-04). |
| `update<Entity>` | `{ id, ...partialFields }` | `{ ...entity }` | Effective-dated fields (`AssetOwnership.effective_from/to`, `HouseholdMember`) create a new row rather than mutating history — "update" here means "close out the old effective period and open a new one," not an in-place field edit, consistent with DM-05/append-only ownership history. |
| `list<Entity>` | Scope filter (e.g. `portfolioId` for Assets). | `{ items: [...] }` | Tenant-scoped via RLS; no pagination cursor specified yet — add before a tenant's record count makes a flat list impractical. |
| `archive<Entity>` | `{ id }` | `{ entity }` | Soft-archive; disposal/closure, not deletion, preserves transactions/valuations/evidence/ownership (Domain Model Section 7). |
| `getPortfolioPosition` | `{ portfolioId }` | `{ totalValue, totalDebt, totalEquity, lvr, perAsset: [{assetId, equity, lvr, attributableEquity, freshness: {valuationEffectiveAt, debtEffectiveAt}}], diagnostics: [...] }` | Implements CAL-001…009 (Section 6) — this is the "Portfolio dashboard" flow from Architecture Section 5. Freshness/effective dates surfaced per CP-10/PER-06; missing valuation on any asset flags that asset rather than failing the whole response. |

## 6. Valuation Contracts

| Operation | Trigger | Input | Output | Notes |
| --- | --- | --- | --- | --- |
| `requestValuationRefresh` | User action or scheduled job. | `{ assetId }` | `{ jobId, status: 'queued' }` | Enqueues background job (ADR-012); does not block the request. |
| `recordValuation` *(internal, called by the refresh job or manual entry)* | — | `{ assetId, amount, currency, valuationType, sourceId, effectiveAt, low?, high?, confidence?, externalReference?, providerMetadata? }` | `{ valuationId }` | Append-only insert, never updates/overwrites a prior row (DM-06/DBV-04). A failed/partial provider response is validated and either stored as a complete observation or rejected with `UPSTREAM_UNAVAILABLE` — never partially persisted (Architecture Section 10 "Partial external response"). |
| `selectValuation` | User overrides the auto-selected valuation (DD-03 policy). | `{ assetId, valuationId, reason }` | `{ selection }` | One selection per asset (UNIQUE), validated same-tenant/same-asset. |
| `ValuationProvider` port *(integration adapter interface, not client-callable)* | — | `fetchValuation(propertyIdentity: {address, providerPropertyId?}): Promise<{ amount, low?, high?, confidence?, asOf, externalReference, raw }>` | Throws a typed `ProviderUnavailableError`/`ProviderInvalidResponseError`, never returns a fabricated/zero value on failure (AV-09). | One adapter implementation per provider (PropTrack/CoreLogic candidates, per BMA); swappable without touching `recordValuation` (ADR-011). |

## 7. Liability Contracts

| Operation | Input | Output | Notes |
| --- | --- | --- | --- |
| `createLoan` | `{ assetId, lenderName, loanName?, originalPrincipal, currency, startDate, repaymentType, rateType, termMonths }` | `{ loanId }` | |
| `recordLoanBalanceSnapshot` | `{ loanId, balance, offsetBalance?, effectiveDate, source, classification }` | `{ snapshotId }` | Append-only (DM-07/DBV-05); "current balance" is always derived by querying latest applicable snapshot, never read off a mutable `Loan.balance` field (none exists). |
| `recordLoanRatePeriod` | `{ loanId, annualRate, effectiveFrom, effectiveTo?, rateType, source }` | `{ ratePeriodId }` | |

## 8. Ledger Contracts

| Operation | Input | Output | Notes |
| --- | --- | --- | --- |
| `createTransaction` | `{ assetId, transactionDate, amount, currency, direction, categoryId, description?, counterparty?, externalReference? }` | `{ transactionId }` or `VALIDATION_FAILED` | `amount` required and >0 (direction carries sign semantics) — `VALIDATION_FAILED` if null/zero (CP-02/DBV-08), never silently coerced to 0. **Rejects `transactionDate` earlier than the asset's `tracking_start_date` through this normal entry path** (DM-18) with a specific error code `BEFORE_TRACKING_START` — a trusted backfill/correction workflow (not this contract) is the only way to override, logged via `AuditEvent`. |
| `correctTransaction` | `{ transactionId, ...correctedFields, reason }` | `{ transaction, auditEventId }` | Correction + `AuditEvent` in the same transaction (Physical Schema Section 15); never a silent in-place edit with no trail (DM-15/ADR-015). |
| `listTransactions` | `{ assetId, dateRange?, categoryId? }` | `{ items: [...] }` | Backs CAL-010/011 — the service applies the `tracking_start_date` floor itself (never relies on the caller to pass a correct date range), so a client can't accidentally "see" fabricated pre-tracking data by passing a wide range. |
| `listTransactionCategories` | — | `{ categories: [...] }` | Global (`tenant_id` NULL) + tenant-specific rows merged, per Physical Schema Section 12 policy. |

## 9. Evidence Contracts *(MVP1: contracts specified, not built — see Architecture Section 4/13)*

| Operation | Input | Output | Notes |
| --- | --- | --- | --- |
| `requestEvidenceUpload` *(MVP2)* | `{ transactionId, filename, mimeType, fileSizeBytes }` | `{ uploadUrl, documentId }` (short-lived signed URL) | Specified now so the Ledger/Transaction contracts don't need reshaping later; **no route is registered/exposed in MVP1.** |
| `linkEvidence` *(MVP2)* | `{ transactionId, documentId, relationshipType }` | `{ link }` | Same MVP1 exclusion. |

## 10. Calculation Service Contracts (internal, pure domain functions)

Not client-facing — called by Sections 4/5/6/8's contracts. Specified here because the Calculation Spec's handoff note (Section 16) explicitly asks for "typed function signatures" before coding.

```
calculateLivePortfolioPosition(input: {
  valuations: SelectedValuation[]; loanBalances: SelectedBalance[]; ownerships?: OwnershipShare[]
}): { equity, attributableEquity?, lvr, diagnostics: DiagnosticMap }   // CAL-001..009

calculateLiveIncomeAndCashFlow(input: {
  transactions: Transaction[]; trackingStartDate: Date; periodStart, periodEnd: Date; valuation?: number; loanInterest?, principal?
}): { rentalIncome, operatingExpenses, noi, cashFlowBeforePrincipal, cashFlowAfterDebtService, yieldPct?, diagnostics: DiagnosticMap }  // CAL-010..017

calculateAssessmentMetrics(input: AssessmentScenarioInput): AsmMetricsResult   // ASM-001..017, Section 4
```

`DiagnosticMap = Record<metricId, { value: number | null; status: 'OK'|'INCOMPLETE_INPUT'|'INVALID_INPUT'|'STALE_INPUT'; missingInputs?: string[] }>` — every metric reports its own status (CP-02/CP-07), never a single pass/fail for the whole call. These functions take only typed values (no DB lookups inside them, per Calc Spec Section 14) — the calling contract is responsible for fetching and shaping input.

## 11. Goals Contracts

| Operation | Input | Output | Notes |
| --- | --- | --- | --- |
| `createGoal` | `{ scope: {ownerId?, householdId?, portfolioId?}, goalType, targetAmount, currency, targetDate?, targetAge? }` | `{ goalId }` | Exactly one scope field set — mirrors the DM-17 "exactly one of" pattern already used for Lead/UserAccount. |
| `getGoalProgress` | `{ goalId }` | `{ progress, projectionClassification: 'FORECAST', diagnostics }` | Projection outputs always `FORECAST`; never persisted as an actual observation (Domain Model Goal note). |

## 12. Reporting Contracts *(MVP2 stub — specified, not built)*

| Operation | Input | Output | Notes |
| --- | --- | --- | --- |
| `generateFyLedger` *(MVP2)* | `{ assetId, financialYear }` | `{ reportRunId, ledger, calculationVersion }` | Deterministic from Transaction/Category data; reconciles exactly (DM-13/DBV-10). No route exposed in MVP1. |
| `generateEoyStatement` *(MVP2)* | `{ reportRunId }` | `{ statement, exportArtifactId? }` | |

## 13. Audit Contract (internal, read-mostly)

| Operation | Input | Output | Notes |
| --- | --- | --- | --- |
| `recordAuditEvent` *(internal, called by every mutating contract above that touches a material entity — not independently client-callable)* | `{ entityType, entityId, action, changeSet?, correlationId }` | `void` | Per ADR-015, material mutations only, not reads. |
| `listAuditHistory` | `{ entityType, entityId }` | `{ events: [...] }` | Read-only; no update/delete contract exists for audit_events at all (matches DBV-03). |

## 14. Integration Adapter Port Interfaces

| Port | Signature | Notes |
| --- | --- | --- |
| `ValuationProvider` | See Section 6. | |
| `CrmProvider` *(new — implements ADR-021)* | `syncLead(lead: {email, name?, phone?, consent}): Promise<{ externalId, status: 'synced' }>` — throws typed `CrmUnavailableError` rather than ever blocking the caller. | Implementation detail (HubSpot API calls, field mapping) lives entirely in `integrations/crm/`, never in the Marketing/Lead Capture domain module (Architecture Section 12 folder layout). Called asynchronously/best-effort from `createLeadAssessment` (Section 3) — failure sets `leads.crm_sync_status='failed'` for a retry job, never rejects the Lead's own save. |
| `CrmSyncRetryJob` *(background)* | Picks up `leads` rows where `crm_sync_status='failed'` or `'pending'` past a threshold; idempotent re-call of `CrmProvider.syncLead`. | |

## 15. Idempotency & Background Job Contracts

| Job | Trigger | Idempotency key | Notes |
| --- | --- | --- | --- |
| Valuation refresh | Schedule or manual request | `(assetId, providerRequestId)` | Prevents a retried provider call from creating duplicate `valuations` rows (Physical Schema Section 15 "Provider ingestion"). |
| CRM sync retry | Schedule, polling `crm_sync_status` | `leadId` | Re-sync is a no-op if `crm_sync_status` is already `'synced'` by the time the job runs (race with a direct sync). |
| Report/export generation *(MVP2)* | User request | `reportRunId` | Retry-safe; source ledger is never affected by a failed/retried export (AV-07/Architecture Section 10). |

## 16. Contract Verification Gates

| ID | Test |
| --- | --- |
| CV-01 | No contract accepts a client-supplied `tenantId`/`userId` and uses it for authorization instead of the server-resolved session context. |
| CV-02 | `createLeadAssessment`/`updateLeadAssessmentScenario` and the authenticated assessment contracts invoke the *same* `calculateAssessmentMetrics` implementation — verified by a shared test fixture producing identical output for identical input through both paths. |
| CV-03 | `promoteAssessment` fails with `UNAUTHORIZED` if called while the assessment's `tenant_id` is still NULL (unconverted Lead). |
| CV-04 | `createTransaction` returns `BEFORE_TRACKING_START` (not silent success, not generic `VALIDATION_FAILED`) when `transactionDate < asset.tracking_start_date`. |
| CV-05 | A simulated `CrmProvider` outage during `createLeadAssessment` still returns `{ ok: true }` to the caller, with `crm_sync_status='failed'` persisted for retry. |
| CV-06 | Every contract in Sections 4–11 that returns a CAL-xxx/ASM-xxx value includes a `diagnostics`/per-metric `status` field — none silently omits it. |
| CV-07 | `getPortfolioPosition` and other authenticated reads never return another tenant's row even when given a syntactically valid foreign id (mirrors AV-01/DBV-01 at the contract layer, not just the DB layer). |

## 17. Claude Code Handoff

Implement contracts module-by-module following the dependency order in Architecture Section 4 (Identity → Marketing/Lead Capture → Investor → Portfolio → Property/Assessment → Valuation/Liability/Ledger → Calculation → Goals → Audit; Evidence/Reporting routes stay unregistered per their MVP1 flags). Each contract's request/response types are the source of truth for the generated TypeScript types — do not let a UI component's convenience reshape a contract's output; add a view-model mapping layer in the UI instead. Build Section 10's calculation functions and their golden tests (Calc Spec Section 11 + this doc's CV-02) before wiring any contract that calls them. Flag any contract that turns out to need a shape not specified here as requiring a superseding decision, same discipline as an ADR.

---
*Investment Portfolio SaaS — API/Application-Service Contracts v0.1 | 3 Oct 2026 | Closes the gap between Architecture/ADRs v0.1 and the Physical Schema — ready for Claude Code handoff alongside both.*
