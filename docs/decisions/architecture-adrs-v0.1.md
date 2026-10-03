# Investment Portfolio Tracking & Management SaaS
## Solution Architecture & Architecture Decision Records — v0.1
*Property-First Web SaaS*

**Status note (3 Oct 2026):** reviewed and saved with two additions locked in against prior decisions: (1) the OD-14 CRM/lead-capture integration (HubSpot free tier) wasn't architecturally represented anywhere in the original draft — added as a module, integration adapter, technology row, trust boundary, ADR-021, and data-ownership row; (2) the Accounting Readiness MVP1-schema/MVP2-UI flag is now cross-referenced in Section 13 so it isn't built prematurely. See `dev-review-architecture-v0.1.md` for the full review.

| Control | Value |
| --- | --- |
| Date | 3 October 2026 |
| Version | 0.1 |
| Parent baselines | BMA v0.1; SRS v0.3; Domain Model/ERD v0.2; Calculation Specification v0.1 |
| Purpose | Define the MVP solution architecture, trust boundaries, component responsibilities, integration patterns and consequential technical decisions before physical schema and implementation. |
| Architecture posture | Cloud-hosted multi-tenant web SaaS; modular monolith; server-authoritative financial data; provider abstractions; security and auditability by design. |

## 1. Architecture Drivers

| Driver | Architectural Implication |
| --- | --- |
| Financial correctness | Canonical server-side calculation services; decimal arithmetic; deterministic tests/versioning. |
| Data provenance | Explicit ACTUAL/ESTIMATE/CALCULATED/ASSUMPTION lineage and effective dates. |
| Multi-tenant privacy | Tenant-aware schema, RLS, server-side authorisation and private storage. |
| Auditability/accounting readiness | Immutable/history-preserving observations, evidence integrity, audit events and reproducible reports. |
| Property-first but extensible | Generic Portfolio/Asset/Ownership core with property modules and future securities extensions. |
| Pre-acquisition funnel | Assessment bounded context separated from owned portfolio; controlled promotion. |
| Public lead-generation funnel *(added)* | Unauthenticated Property Assessment + contact capture is a deliberate trust-boundary exception, requiring its own abuse-resistance, consent segregation and CRM sync boundary (OD-14). |
| External valuation data | Provider-neutral integration boundary; credentials server-side; graceful degradation. |
| Lean MVP delivery | Managed platform services and modular monolith rather than distributed microservices. |
| Future mobile/API | Backend/domain services not coupled exclusively to browser UI. |
| Sensitive evidence files | Private object storage, short-lived authorised access and metadata/integrity controls. |

## 2. System Context

```
Users / Prospects
      |
      | HTTPS
      v
Responsive Web Application
      |
      v
SaaS Application / API Boundary
  |       |        |         |          |
  |       |        |         |          +--> CRM / Email-Marketing Adapter --> External CRM (HubSpot free tier initially)
  |       |        |         +--> Email / Notifications (future/limited MVP)
  |       |        +------------> Property Valuation Provider Adapter --> External Provider(s)
  |       +---------------------> Private Evidence Object Storage
  +-----------------------------> PostgreSQL / Auth
                                      |
                                      +--> Scheduled / Background Jobs
```

Browser is an untrusted client. It never receives database service credentials or third-party provider secrets.

The SaaS backend is the authoritative application boundary for financial mutations, calculations and authorisation.

External property-data providers are outside the trust boundary and their responses are stored with source/effective-time metadata.

Evidence documents are private customer data; object storage access is mediated by authorisation and short-lived access mechanisms.

The free Property Assessment entry point is intentionally reachable without authentication; everything behind it that touches portfolio/financial data is not.

## 3. Proposed MVP Technology Baseline

| Layer | Proposed Technology | Rationale / Boundary |
| --- | --- | --- |
| Web UI | Next.js + TypeScript | Responsive SSR/client web experience; familiar ecosystem; no native app in MVP. |
| Application/API | Next.js server routes/actions with TypeScript domain modules | One deployable modular monolith initially; domain logic isolated from UI. |
| Database | PostgreSQL via Supabase | Relational integrity, decimal/date support, RLS, managed operations. |
| Authentication | Supabase Auth | Managed authentication; application still performs server-side authorisation. |
| Object storage | Supabase Storage initially | Private evidence storage with tenant-aware access policies; abstract storage operations. |
| Hosting/deployment | Vercel for web/application | Simple managed deployment for Next.js; environment/secrets separated by environment. |
| Background work | Managed scheduled functions/jobs appropriate to hosting platform | Valuation refresh/report generation; avoid blocking browser requests. |
| CRM / lead capture *(added)* | HubSpot free tier behind a provider-neutral adapter; Brevo flagged as fallback (OD-14) | Mirrors the valuation-provider adapter pattern; keeps marketing/lead storage swappable without reworking the Lead domain entity. |
| Payments | Stripe - later/when commercial onboarding is implemented | Keep billing outside financial portfolio ledger; webhook verification required. |
| Observability | Structured application logs + error/performance monitoring | No raw sensitive evidence or unnecessary PII in telemetry. |
| Analytics | Product analytics with privacy controls - later decision | Do not leak portfolio values/addresses into third-party analytics by default. |

## 4. Logical Application Modules

| Module | Responsibilities | May Depend On |
| --- | --- | --- |
| Identity & Access | Session, tenant membership, roles, authorisation context. | Auth provider, tenant repository |
| Marketing / Lead Capture *(added)* | Lead record, consent capture, CRM sync status, conversion to UserAccount. | Integration (CRM adapter) |
| Investor | Owner, household, owner profile. | Identity |
| Portfolio | Portfolio, Asset, AssetOwnership, aggregation. | Investor, valuation/liability interfaces |
| Property | Owned property identity/acquisition data. | Portfolio |
| Assessment | Prospects, scenarios, assumptions, FR-79 calculations, promotion. | Calculation, property identity, Marketing/Lead Capture (pre-account creator) |
| Valuation | Valuation records, source metadata, selection policy, provider adapters. | Property/Asset, integration |
| Liability | Loans, rate periods, balance snapshots. | Asset |
| Ledger | Actual transactions, categories, accounting classifications. | Asset |
| Evidence *(MVP1: module/schema exist; no UI until MVP2)* | Document metadata, private storage, transaction links, integrity hash. | Ledger, storage adapter |
| Calculation | Canonical CAL/ASM pure/domain services. | Typed domain inputs only |
| Reporting *(MVP1: module/schema exist; no UI until MVP2)* | Portfolio views, FY ledger, EOY statement, exports. | Ledger, Evidence, Calculation |
| Goals | Targets/progress/forecast classification. | Portfolio/Owner |
| Audit | Material change events and correlation metadata. | All mutation modules |
| Integration | Valuation provider, CRM/email-marketing provider *(added)*, future bank/property manager/broker adapters. | External systems only through explicit ports |

## 5. Request / Data Flow Patterns

| Flow | Sequence |
| --- | --- |
| Authenticated mutation | Browser -> server endpoint/action -> authenticate -> resolve tenant -> authorise operation -> validate input -> domain service -> transactionally persist -> audit event -> response. |
| Portfolio dashboard | Browser -> server/API -> tenant-safe repositories -> fetch source observations -> calculation service -> DTO/view model with provenance/freshness -> browser. |
| Property assessment (free/public) | Browser -> assessment API (unauthenticated) -> capture/validate Lead contact + consent -> sync Lead to CRM adapter (async/best-effort) -> validate assumptions -> canonical ASM calculation service -> persist scenario against Lead -> return indicative results. |
| Account conversion | Lead signs up -> UserAccount/Tenant created -> Lead.converted_user_id set -> Lead-owned PropertyAssessment(s) reattached to new Tenant. |
| Add to Portfolio | Assessment -> explicit confirmation (requires authenticated Tenant) -> application service creates Asset/Property + promotion link -> assumptions remain assumptions -> user confirms actual acquisition/ownership/loan data. |
| Valuation refresh | Scheduler/user request -> valuation integration service -> provider adapter -> validate/map response -> persist new Valuation observation -> selection policy -> audit/diagnostic. |
| Evidence upload *(MVP2)* | Browser requests upload workflow -> server authorises tenant/transaction -> private storage upload -> hash/metadata validation -> EvidenceDocument + link persisted. |
| EOY reporting *(MVP2)* | User selects property/FY -> server queries actual ledger -> validates completeness/evidence status -> reporting service aggregates -> calculation version stamped -> export generated. |

## 6. Trust Boundaries & Security Model

| Boundary | Controls |
| --- | --- |
| Browser -> Application | HTTPS; authenticated sessions; CSRF protections appropriate to framework; input validation; no trust in tenant/entity IDs supplied by browser. |
| Public/unauthenticated assessment endpoint *(added)* | Rate limiting and bot/abuse protection (e.g. CAPTCHA/behavioural signal) sized to the free-tier limits in FR-85; cannot read or mutate any authenticated tenant's data; marketing consent recorded separately from account/terms necessity (FR-86) and never inferred from calculator use. |
| Application -> Database | Server identity/limited credentials; RLS where applicable; parameterised ORM/query layer; tenant context; least privilege. Leads table is explicitly outside tenant RLS until conversion (DM-19). |
| Application -> Object Storage | Private buckets; tenant-scoped paths/metadata; signed short-lived retrieval/upload; server validates association. |
| Application -> External APIs | Secrets server-side only; outbound timeout/retry/rate limiting; response validation; provider provenance stored. Applies equally to the valuation provider and the CRM adapter. |
| Background jobs | Authenticated service identity; tenant-scoped job payload; idempotency; audit/correlation IDs. |
| Observability | Redaction; no receipt contents, secrets, full financial payloads, lead contact details or unnecessary addresses in logs. |

## 7. Deployment Model

```
Production
  DNS / TLS
     |
   Vercel
  Next.js Web + Server Application
     |
     +---- Supabase Project
     |       |- PostgreSQL
     |       |- Auth
     |       `- Private Storage
     |
     +---- Property Data Provider(s)
     |
     +---- CRM / Email-Marketing Provider (HubSpot free tier initially)
     |
     `---- Approved supporting SaaS (billing/monitoring as introduced)
```

Separate development / test / production environments.

No production customer data copied into lower environments without explicit sanitisation controls.

Use separate credentials, databases/projects and secrets per environment.

Database migrations are version-controlled and applied through controlled deployment workflow.

Production backup/restore capability must be tested, not merely enabled.

Provider sandbox/test endpoints should be used where available.

## 8. Architecture Decision Records

### ADR-001 — Web SaaS as the initial delivery channel
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Initial users need low-friction access and the product must support free property assessment plus authenticated portfolio management. |
| Decision | Deliver a responsive browser-based SaaS. No native mobile or desktop application in MVP. Maintain backend boundaries suitable for future mobile/API clients. |
| Consequences / Trade-offs | Fastest distribution and update model; requires responsive design and online connectivity. Native-device features deferred. |

### ADR-002 — Modular monolith before microservices
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | The main MVP risks are domain correctness, provenance, security and product discovery rather than independent service scaling. |
| Decision | Build one deployable application with explicit domain modules and dependency boundaries. Do not create networked microservices for core MVP domains. |
| Consequences / Trade-offs | Lower operational complexity and easier transactions/testing. Modules must remain clean enough to extract later if justified. |

### ADR-003 — Next.js and TypeScript for web/application layer
| Field | Decision Record |
| --- | --- |
| Status | Proposed - baseline unless implementation spike identifies blocker |
| Context | Web-first product, user familiarity with Next.js/Vercel, and value in sharing types across UI/API/domain boundaries. |
| Decision | Use Next.js + TypeScript for UI and initial server application/API. Financial domain logic must live outside UI components. |
| Consequences / Trade-offs | Rapid delivery and coherent stack. Avoid framework-specific coupling in domain calculation code. |

### ADR-004 — PostgreSQL/Supabase as system of record
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Domain is highly relational and requires integrity, temporal observations, accounting queries and tenant controls. |
| Decision | Use PostgreSQL managed through Supabase for authoritative structured data. |
| Consequences / Trade-offs | Strong relational constraints/RLS. Requires disciplined schema/migrations and tenant-safe access. |

### ADR-005 — Server-authoritative financial calculations
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Different client/server formulas would create inconsistent financial outputs and audit problems. |
| Decision | Canonical CAL/ASM calculations execute in shared/server domain code; UI may preview only by invoking/reusing the same canonical implementation. |
| Consequences / Trade-offs | Consistent reports and tests. Some interactive calculations may require efficient server calls or safe shared pure modules. |

### ADR-006 — Decimal arithmetic for authoritative financial values
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Binary floating-point can introduce monetary rounding errors. |
| Decision | Use PostgreSQL NUMERIC/DECIMAL and a TypeScript decimal strategy/library for authoritative money/percentage calculations. Do not use JS Number as the authoritative calculation representation where precision matters. |
| Consequences / Trade-offs | Additional library/serialization discipline; materially safer financial behaviour. |

### ADR-007 — Tenant isolation using defence in depth
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Product stores PII, addresses, financial data and evidence documents. |
| Decision | Every customer-owned aggregate resolves to a tenant. Apply server-side authorisation plus database RLS/policies and tenant-safe repository patterns. |
| Consequences / Trade-offs | More implementation/testing effort; reduces impact of a single missed application filter. |

### ADR-008 — Private object storage for invoices and receipts
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Accounting evidence can contain sensitive personal/financial information and should not be stored as public files or database blobs. |
| Decision | Store binaries in private object storage; persist metadata/hash/storage key in DB; use short-lived authorised access. |
| Consequences / Trade-offs | Requires storage lifecycle/security policies; keeps relational DB efficient and access auditable. |

### ADR-009 — Historical observations for valuations and loan balances
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Equity/LVR and trends must be reproducible and source dates matter. |
| Decision | Append Valuation and LoanBalanceSnapshot observations. Current values are selected/derived; do not overwrite historical observations. |
| Consequences / Trade-offs | More rows and selection logic; preserves auditability and trend history. |

### ADR-010 — Separate pre-acquisition Assessment bounded context
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Assessment data is hypothetical and marketing-facing; owned portfolio data must remain factual/accounting-safe. |
| Decision | PropertyAssessment/Scenario/Assumption remain outside Asset/Property aggregation. Explicit AssessmentPromotion links a purchased prospect to live property. |
| Consequences / Trade-offs | Some duplicate/reconfirmed fields at transition; prevents assumptions contaminating actual portfolio records. |

### ADR-011 — Provider-neutral property valuation integration
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Australian property data licensing/API availability and commercial terms remain unresolved and may change. |
| Decision | Define an internal ValuationProvider port/interface and provider-specific adapters. Persist provider/source metadata, raw external identifiers where permitted, and normalised valuation observations. |
| Consequences / Trade-offs | Slight abstraction cost now; prevents vendor lock-in and supports fallback/provider changes. |

### ADR-012 — Synchronous user work plus asynchronous background jobs
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Some operations are interactive; valuation refreshes, large exports and scheduled work may be slow/rate-limited. |
| Decision | Keep simple CRUD/calculation requests synchronous. Use background jobs for scheduled valuation refresh, retryable provider calls, large report/export generation and later integrations. |
| Consequences / Trade-offs | Requires job idempotency/status/error handling; protects request latency. |

### ADR-013 — Derived reports are outputs, not source financial records
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | FY ledgers and EOY statements must reconcile to transactions and remain explainable. |
| Decision | Transactions/categories/evidence are source records. Reports are derived; if persisted, store immutable report metadata/output and calculation/data-version references. |
| Consequences / Trade-offs | Re-generation remains possible; avoids report totals drifting away from ledger. |

### ADR-014 — API/integration secrets remain server-side
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Property provider, billing and future integration credentials must not be exposed to browser clients. |
| Decision | All privileged external API calls execute server-side. Secrets live in managed environment secret stores and are never embedded in client bundles. |
| Consequences / Trade-offs | Backend mediation required; standard SaaS security posture. |

### ADR-015 — Audit material mutations, not every read
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Financial corrections, reclassification, ownership changes and promotion need traceability without creating unusable audit noise. |
| Decision | Create AuditEvent records for material mutations and security-sensitive actions. Ordinary read events go to security/operational telemetry only where necessary. |
| Consequences / Trade-offs | Balanced audit volume. Audit event taxonomy must be defined during implementation. |

### ADR-016 — Soft history preservation with controlled deletion
| Field | Decision Record |
| --- | --- |
| Status | Proposed |
| Context | Accounting/audit records need history, while privacy obligations may require deletion/anonymisation in some circumstances. |
| Decision | Prefer archive/soft-delete for financial domain records and immutable observation history. Implement a separate privacy deletion/anonymisation workflow rather than casual hard deletes. |
| Consequences / Trade-offs | Needs legal/privacy retention policy before production launch. Applies to Lead records too (ties to DD-11). |

### ADR-017 — No general-purpose EAV model for core finance
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Typed constraints and predictable queries are essential for financial correctness. |
| Decision | Use typed relational tables for core entities. Limited flexible assessment assumption representation is permitted only behind a controlled type catalogue and may be replaced with typed columns as the model stabilises. |
| Consequences / Trade-offs | Schema evolution required for new concepts; substantially better integrity and developer comprehension. Per the Calculation Specification's finalised FR-79 input list (13 named inputs), this is now ready to move to typed columns rather than EAV for v1. |

### ADR-018 — Future asset classes extend the core, not property tables
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Roadmap includes shares, ETFs, cash and superannuation. |
| Decision | Portfolio/Asset/Ownership remain generic. Securities add Instrument/Position/MarketPrice/CorporateAction concepts rather than forcing them into Property/Valuation tables. |
| Consequences / Trade-offs | Requires deliberate polymorphic/domain modelling; avoids property-centric rewrite. |

### ADR-019 — No AI/LLM dependency in authoritative MVP calculations
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Core metrics and accounting outputs must be deterministic, testable and explainable. |
| Decision | Do not use an LLM to calculate, classify authoritatively or fabricate missing financial values. AI may later assist extraction/categorisation only with review and provenance. |
| Consequences / Trade-offs | Less automation initially; protects financial integrity and testability. |

### ADR-020 — Versioned schema, calculation rules and APIs
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | Reports and outputs need explainability as product logic evolves. |
| Decision | Version DB migrations in source control; assign calculation-version identifiers to materially changed formulas/report logic; evolve external APIs compatibly when introduced. |
| Consequences / Trade-offs | Adds release discipline; enables reproducibility and controlled evolution. |

### ADR-021 — CRM/email-marketing integration behind a provider-neutral adapter *(new)*
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | OD-14 resolved on a free-tier CRM (HubSpot) for cost reasons, with Brevo flagged as a fallback if volume/economics shift. Hard-wiring to one vendor would repeat the vendor-lock-in risk ADR-011 already avoided for valuation data. |
| Decision | Define an internal CrmProvider port/interface mirroring ValuationProvider (ADR-011). The Lead entity stores `crm_provider`/`crm_external_id`/`crm_sync_status`; adapter implementation details (API calls, field mapping) live entirely in the Integration module, never in the Marketing/Lead Capture domain module. |
| Consequences / Trade-offs | Slight abstraction cost now; avoids a rework if HubSpot's free tier is outgrown. CRM sync should be best-effort/async so a CRM outage never blocks a Lead from completing the free assessment. |

### ADR-022 — Public, unauthenticated Property Assessment entry point as a scoped trust-boundary exception *(new)*
| Field | Decision Record |
| --- | --- |
| Status | Accepted |
| Context | The rest of the MVP assumes authenticated-only access (ADR-007's tenant isolation applies to all portfolio/financial data). The free lead-gen assessment tool is a deliberate, narrow exception to reach prospects before signup (SN-26, FR-85). |
| Decision | The assessment+lead-capture endpoint is explicitly carved out as public, but is rate-limited/abuse-resistant, cannot read or write any tenant-scoped data, and records marketing consent separately from account/terms necessity (FR-86). Everything past initial capture (saved assessments beyond the free limit, Add to Portfolio) requires authentication. |
| Consequences / Trade-offs | Adds a distinct abuse-surface to secure (rate limiting, bot detection) that the rest of the MVP doesn't need. Keeps the authenticated trust boundary (ADR-007) uncompromised rather than carving exceptions into it. |

## 9. Data Ownership and Source-of-Truth Matrix

| Information | Authoritative Source | Derived / Cache |
| --- | --- | --- |
| Account/session | Auth provider + application membership | Session/cache only |
| Lead / pre-account contact *(added)* | `leads` table in PostgreSQL | CRM record is a synced copy, never authoritative — a CRM outage or sync failure must not lose or corrupt the Lead's own data. |
| Owner/household | PostgreSQL domain tables | View models |
| Property acquisition | Property/transaction records | Dashboard summaries |
| Current property value | Selected Valuation observation | Current-value view/cache |
| Current debt | Applicable LoanBalanceSnapshot(s) | Current-debt view/cache |
| Actual rent/expense | Transaction ledger (from tracking_start_date onward) | FY/report aggregates |
| Receipt/invoice | Private object storage + DB evidence metadata | Thumbnails/previews if used |
| Assessment assumptions | AssessmentScenario/Assumption | ASM outputs |
| Equity/LVR/yield/cash flow | Canonical calculation service over source records | Dashboard/report result |
| EOY statement | Derived from ledger/report service | Persisted immutable export optional |
| Audit history | AuditEvent + historical domain records | Operational dashboards |

## 10. Failure and Resilience Behaviour

| Failure | Required Behaviour |
| --- | --- |
| Valuation provider unavailable | Existing valuations remain available with dates; refresh fails visibly/retryably; do not replace value with zero/null silently. |
| CRM sync unavailable *(added)* | Lead is saved and the free assessment proceeds regardless; `crm_sync_status` marks FAILED for retry; a CRM outage never blocks or loses a Lead. |
| Evidence storage unavailable | Financial transaction may be saved if workflow permits, but evidence upload status/error remains explicit and retryable. |
| Background job duplicated | Idempotency prevents duplicate valuation/report side effects. |
| Database transaction fails | Mutation and audit/source changes roll back consistently where atomicity is required. |
| Partial external response | Validate required provider fields; store only valid normalised observation or mark integration failure. |
| Calculation input incomplete | Return diagnostic/incomplete state; never fabricate missing value. |
| Export generation fails | Source ledger remains unaffected; export can be retried. |
| Tenant authorisation failure | Deny operation without revealing whether another tenant's resource exists. |

## 11. Non-Functional Architecture Targets

| Area | Initial Target / Design Intent |
| --- | --- |
| Availability | Commercial SaaS baseline using managed services; formal SLA deferred until pricing/launch plan. |
| Performance | Common authenticated pages should feel interactive; target p95 API response for ordinary non-provider CRUD/calculation requests <500 ms under expected MVP load, subject to validation. |
| Security | OWASP-aligned secure development; dependency scanning; secret management; RLS/authorisation tests. Rate limiting/bot protection specifically for the public assessment endpoint. |
| Backup/Recovery | Automated DB backups plus documented restore test before production launch; evidence storage recovery/lifecycle addressed. |
| Scalability | Stateless web/application instances where practical; DB indexed by tenant/FKs/dates; background workloads isolated from request path. |
| Accessibility | Responsive keyboard-usable web UI; target WCAG 2.1 AA/appropriate current standard before public launch. |
| Observability | Correlation IDs, structured errors, job/provider diagnostics and security-relevant events without sensitive payload leakage. |
| Maintainability | Module boundaries, typed contracts, migrations, unit/integration/E2E tests and ADR discipline. |
| Portability | Business/domain logic avoids unnecessary Vercel/Supabase-specific APIs; infrastructure may still use managed capabilities intentionally. |

## 12. Repository / Code Organisation Recommendation

```
src/
  app/                  # Next.js routes/pages/server entry points
  modules/
    identity/
    marketing/          # Lead capture, consent, CRM sync status
    investor/
    portfolio/
    property/
    assessment/
    valuation/
    liability/
    ledger/
    evidence/           # MVP1: schema/module only, no UI routes until MVP2
    reporting/          # MVP1: schema/module only, no UI routes until MVP2
    goals/
    audit/
  domain/
    calculations/       # CAL/ASM deterministic functions
    money/
    provenance/
  integrations/
    valuation/
    crm/                # CRM/email-marketing adapter (HubSpot initially)
    storage/
    billing/
  db/
    repositories/
    migrations/         # or Supabase migration location
  shared/
    validation/
    authz/
    errors/
    observability/
tests/
  unit/
  integration/
  e2e/
  golden/
```

The exact framework folder layout may vary, but dependency direction should keep domain calculations and business rules independent of React components and external provider SDKs.

## 13. Physical Architecture Work Still Required

PostgreSQL/Supabase physical schema: column types, constraints, enums, indexes, FK actions and migration order.

Concrete RLS policies and tenant-context strategy, including the Leads-table exception (no tenant_id until conversion, DM-19).

Authentication/session flows, invitation/collaboration model and role matrix.

Evidence storage bucket/path policy, upload limits, malware/content validation approach and retention. **Build schema/storage structure in MVP1; do not build upload UI/workflow until MVP2** (Accounting Readiness scope decision, 3 Oct 2026).

Valuation provider API selection, licensing, quotas, caching and raw-response retention permissions.

CRM provider selection confirmation (HubSpot free-tier limits, field mapping, consent/Spam Act compliance requirements) before the adapter is built.

Background job technology selection compatible with deployment platform.

Backup/restore RPO/RTO targets before production.

Privacy retention/deletion policy and Australian legal review — covers both accounting records and unconverted Lead data (DD-11).

Billing/subscription architecture when commercial tiers are defined.

Operational monitoring/vendor selection and incident-response process.

## 14. Architecture Verification Before Coding

| Gate | Evidence Required |
| --- | --- |
| AV-01 | A browser cannot access another tenant's portfolio, transaction, assessment or evidence by changing IDs. |
| AV-02 | No provider/service secret is present in browser-delivered JavaScript or network payloads. |
| AV-03 | CAL/ASM golden tests produce the Calculation Specification outputs using canonical server/domain code. |
| AV-04 | Creating an assessment does not create/influence Asset/Property portfolio totals. |
| AV-05 | Promotion preserves assumption provenance and requires confirmation for actual acquisition data. |
| AV-06 | New valuation/loan balance observations preserve historical records. |
| AV-07 | EOY statement totals reconcile to ledger transactions and evidence status is traceable. |
| AV-08 | Evidence objects are private and unauthorised direct access fails. |
| AV-09 | External valuation outage does not corrupt/remove last known valuation. |
| AV-10 | Database backup can be restored in a non-production recovery exercise before launch. |
| AV-11 *(new)* | The public assessment/lead-capture endpoint cannot read or mutate any authenticated tenant's data, is rate-limited, and marketing consent is stored distinctly from account/terms necessity; a simulated CRM outage does not block or lose a Lead submission. |

## 15. Claude / Claude Code Handoff

Treat these ADRs as architecture constraints unless explicitly superseded by a later ADR. Next, derive the physical PostgreSQL/Supabase schema, RLS policies, API/application-service contracts and migration sequence. Before implementation, flag any proposed design that conflicts with an Accepted ADR. Proposed ADRs may be challenged with evidence, but Claude Code must not silently replace them. Optimise first for correctness, tenant safety, auditability and maintainability; avoid premature distributed-system complexity. Do not build Evidence/Reporting UI in MVP1 even though their modules/schema exist; do not give the Leads table a tenant_id before conversion; do not let a CRM outage block the free assessment flow.

---
*Investment Portfolio SaaS — Architecture & ADRs v0.1 | 3 Oct 2026 | Reviewed and extended 3 Oct 2026: ADR-021 (CRM adapter), ADR-022 (public endpoint trust boundary), AV-11, plus module/matrix/technology additions for Lead capture and the Accounting Readiness MVP1/MVP2 flag. See `dev-review-architecture-v0.1.md`.*
