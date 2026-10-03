# Investment Portfolio Tracking & Management SaaS
## Calculation Specification — v0.1
*Property Portfolio + Property Assessment*

| Control | Value |
| --- | --- |
| Date | 3 October 2026 |
| Parents | BMA v0.1; SRS v0.3; Domain Model/ERD v0.2 |
| Purpose | Canonical formulas, inputs, period rules, missing-data behaviour, examples and verification cases for live property and FR-79 assessment metrics. |
| Boundary | Live metrics use actual transactions/balances plus selected valuations. Assessment metrics use assumptions/estimates and remain indicative. |

## 1. Calculation Principles

| ID | Rule |
| --- | --- |
| CP-01 | Each metric has one canonical formula and documented denominator. |
| CP-02 | Unknown is NULL/unknown, never silently zero. Required unknown input makes the dependent metric unavailable. |
| CP-03 | Preserve ACTUAL, ESTIMATE, CALCULATED and ASSUMPTION/FORECAST lineage. |
| CP-04 | Live rent/expenses come from actual transactions; never backfill them with assessment estimates. |
| CP-05 | Assessment outputs are indicative and never become actual merely through Add to Portfolio. |
| CP-06 | Use decimal arithmetic for money. Calculate from unrounded values; round for display. |
| CP-07 | Zero denominator => unavailable, not 0 or infinity. |
| CP-08 | Principal repayment is not operating expense; CapEx is not ordinary maintenance. |
| CP-09 | Period metrics identify period/annualisation; point-in-time metrics identify as-at dates. |
| CP-10 | Valuation/debt freshness must be visible for equity/LVR calculations. |

## 2. Symbols

| Symbol | Meaning |
| --- | --- |
| V | Selected current live property valuation. |
| D | Sum of applicable current outstanding loan principal. |
| O | Effective ownership fraction. |
| AP | Assessment asking price. |
| P | Confirmed purchase price (live) or proposed purchase price (assessment). |
| R | Rental income: actual live / estimated assessment. |
| OE | Operating expenses excluding finance, principal and CapEx. |
| I | Interest/finance cost. |
| PR | Principal repaid. |
| CapEx | Capital expenditure/improvements. |
| AC | Acquisition costs. |
| L | Proposed assessment loan principal. |
| r | Nominal annual interest rate decimal. |
| n | Repayments/year. |
| N | Total repayment periods. |
| NOI | R - OE. |

## 3. Live Portfolio Position

| ID | Metric | Formula | Example | Rule |
| --- | --- | --- | --- | --- |
| CAL-001 | Estimated Property Equity | V - D | V=1,040,000; D=524,000 => 516,000 | V required; confirmed no-debt may use D=0. |
| CAL-002 | Attributable Property Value | V × O | 1,040,000×50%=520,000 | Use ownership effective at as-at date. |
| CAL-003 | Attributable Debt (MVP) | D × O | 524,000×50%=262,000 | Proportional-debt assumption; later borrower-specific. |
| CAL-004 | Attributable Equity | (V-D) × O | 516,000×50%=258,000 | Unavailable if ownership unresolved. |
| CAL-005 | Property LVR | D / V ×100 | 524,000/1,040,000=50.38% | System LVR may differ from lender LVR. |
| CAL-006 | Portfolio Property Value | Σ selected V | 1.04m+0.91m=1.95m | Exclude assessments; flag missing valuations. |
| CAL-007 | Portfolio Debt | Σ applicable D | 524k+410k=934k | Flag missing/stale balances. |
| CAL-008 | Portfolio Estimated Equity | ΣV-ΣD | 1.95m-934k=1.016m | Show completeness/freshness. |
| CAL-009 | Portfolio LVR | ΣD / ΣV ×100 | 934k/1.95m=47.90% | Never average property LVRs. |

## 4. Live Income, Expense, Yield and Cash Flow

| ID | Metric | Formula | Rule |
| --- | --- | --- | --- |
| CAL-010 | Actual Rental Income | Σ actual rental-income transactions in selected period | No estimated rent substitution. Period is bounded below by the asset's tracking_start_date — a period before tracking_start_date is excluded/"not tracked", never summed as $0. |
| CAL-011 | Operating Expenses | Σ actual OE transactions | Exclude interest, principal and CapEx. Same tracking_start_date period floor as CAL-010. |
| CAL-012 | NOI | R - OE | Before financing and CapEx. |
| CAL-013 | Gross Rental Yield — Live | Annualised actual rent / V ×100 | Prefer TTM actual rent. Shorter periods must say Annualised. If less than one period of tracked history exists since tracking_start_date, use the shorter tracked period, annualised and clearly labelled — never pad with pre-tracking months. |
| CAL-014 | Net Property Yield — Before Finance | Annualised NOI / V ×100 | Denominator = selected current value. |
| CAL-015 | Cash Flow Before Principal | R - OE - I | Principal excluded; example 28,080-11,656-14,850=1,574. |
| CAL-016 | Cash Flow After Debt Service | R - OE - I - PR | Principal is cash outflow, not expense. |
| CAL-017 | Net Cash Movement After CapEx | R - OE - I - PR - CapEx + defined other cash flows | Not an investment-return metric. |

## 5. Value and Wealth Drivers

| ID | Metric | Formula / Treatment |
| --- | --- | --- |
| CAL-018 | Unadjusted Estimated Capital Appreciation | V - confirmed purchase price. Not taxable capital gain. |
| CAL-019 | Valuation Change | V_end - V_start for comparable selected valuations. |
| CAL-020 | Principal Reduction | D_start - D_end adjusted for drawdowns/refinance/new borrowing. |
| CAL-021 | Wealth Driver Decomposition | Valuation change + adjusted principal reduction + retained operating cash flow; show CapEx/contributions separately. Do not call total return yet. |
| CAL-022 | Analytical Acquisition Basis | Purchase price + configured acquisition costs + configured capital improvements. Not tax cost base. |

## 6. Period Rules

| ID | Rule |
| --- | --- |
| PER-01 | TTM is preferred for live current-yield metrics when 12 months of actual history exists since the asset's tracking_start_date — not 12 calendar months of ownership. A property tracked for only 4 months has 4 months of eligible history, regardless of how long it's been owned. |
| PER-02 | Australian FY initial reporting default: 1 July–30 June; keep reporting boundaries configurable. |
| PER-03 | Generic short-period annualisation: period amount × 365 / days in period; label Annualised. |
| PER-04 | Estimated weekly rent ×52; fortnightly ×26; monthly ×12. Never monthlyise weekly rent as ×4×12. |
| PER-05 | Actual cash-received rent preserves vacancy/non-payment; do not fill gaps with estimated rent. |
| PER-06 | Equity/LVR are as-at metrics; display valuation and debt effective dates. |

## 7. FR-79 Property Assessment Inputs

| Input | Class | Use / Rule |
| --- | --- | --- |
| Address/property | REFERENCE | Assessment identity only. |
| Asking price AP | ASSUMPTION | Seller/advertised reference. |
| Proposed purchase price P | ASSUMPTION | Primary assessment denominator; not actual purchase price. |
| Estimated rent | ESTIMATE | Capture frequency. |
| Vacancy allowance | ASSUMPTION | Optional % or weeks/year; never silently default. |
| Operating expenses | ASSUMPTION | Itemised/annual; missing is unknown. |
| Acquisition costs AC | ASSUMPTION | Itemise duty/legal/inspection/etc where entered. |
| Deposit/equity | ASSUMPTION | Amount/% or derive from loan. |
| Proposed loan L | ASSUMPTION | Validate conflicts with deposit. |
| Interest rate r | ASSUMPTION | Nominal annual rate. |
| Loan term | ASSUMPTION | Years. |
| Repayment type | ASSUMPTION | IO or P&I must be explicit. |
| Frequency | ASSUMPTION | Monthly/fortnightly/weekly. |
| Immediate works/other upfront cash | ASSUMPTION | Separate from ordinary operating expense. |

## 8. FR-79 Indicative Assessment Metrics

| ID | Metric | Formula | Example / Qualification |
| --- | --- | --- | --- |
| ASM-001 | Price vs Asking | P-AP; %=(P-AP)/AP×100 | 800k ask, 780k proposal => -20k / -2.50%. |
| ASM-002 | Gross Rental Yield | Annual estimated rent / P ×100 | 750/wk=39k; /780k=5.00%. |
| ASM-003 | Vacancy-Adjusted Rent | Annual estimated rent ×(1-vacancy rate) | 39k×98%=38,220. If weeks used, do not also apply %. |
| ASM-004 | Indicative NOI | Vacancy-adjusted rent - estimated OE | 38,220-10,000=28,220. |
| ASM-005 | Net Yield Before Finance | Indicative NOI / P ×100 | 28,220/780k=3.62%. |
| ASM-006 | Proposed LVR | L / P ×100 | 624k/780k=80.00%; not lender-approved LVR. |
| ASM-007 | Deposit / Purchase Equity | P - L | 780k-624k=156k; special handling if financed costs. |
| ASM-008 | Upfront Cash Required | Purchase equity + AC + other upfront cash not financed | 156k+35k+10k=201k; prevent double count. |
| ASM-009 | IO Annual Interest | L × r | 624k×6%=37,440/year. |
| ASM-010 | P&I Periodic Repayment | L × [i(1+i)^N]/[(1+i)^N-1], i=r/n, N=years×n | 624k, 6%, 30y monthly ≈3,741/month. |
| ASM-011 | Annual P&I Debt Service | Unrounded periodic payment × n | ≈44,892/year. |
| ASM-012 | IO Cash Flow Before Principal | Indicative NOI - annual IO interest | 28,220-37,440=-9,220/year. |
| ASM-013 | P&I Cash Flow After Debt Service | Indicative NOI - annual P&I debt service | ≈28,220-44,892=-16,672/year. |
| ASM-014 | Cash-on-Cash Yield | Defined annual cash flow / upfront cash invested ×100 | Must state cash-flow definition; before tax. |
| ASM-015 | Break-Even Rent | (OE + annual debt service) / occupancy factor | (10k+44,892)/0.98≈56,012/year≈1,077/week. |
| ASM-016 | Acquisition Cost Ratio | AC / P ×100 | 35k/780k=4.49%. |
| ASM-017 | Total Acquisition Cash Basis | P + AC + immediate CapEx | 780k+35k+10k=825k; analytical, not tax cost base. |

## 9. Worked Assessment Example

| Input | Value |
| --- | --- |
| Asking / proposed price | $800,000 / $780,000 |
| Estimated rent | $750/week = $39,000/year |
| Vacancy | 2% |
| Estimated OE | $10,000/year |
| Loan | $624,000 |
| Rate / term | 6.00% / 30 years |
| Repayment | P&I monthly |
| Acquisition costs | $35,000 |
| Immediate works | $10,000 |

| Output | Result |
| --- | --- |
| Price vs asking | -$20,000 (-2.50%) |
| Gross yield | 5.00% |
| Vacancy-adjusted rent | $38,220 |
| NOI | $28,220 |
| Net yield before finance | 3.62% |
| LVR | 80.00% |
| Deposit | $156,000 |
| Upfront cash | $201,000 |
| P&I repayment | ≈$3,741/month |
| Annual debt service | ≈$44,892 |
| Cash flow after debt service | ≈-$16,672/year |
| Break-even rent | ≈$56,012/year (~$1,077/week) |

## 10. Missing / Invalid Data Behaviour

| Condition | Behaviour |
| --- | --- |
| Required denominator missing/zero | Metric unavailable; identify required input. |
| Estimated rent missing | Assessment yield/cash flow unavailable. |
| Expense assumption missing | NOI/net yield/cash flow unavailable or explicitly partial; never assume zero. |
| Loan rate missing | Debt service unavailable; LVR may still calculate. |
| Valuation/loan stale | Calculation may display per policy but must surface effective date/staleness. |
| Ownership invalid | Attributable metrics unavailable/flagged. |
| Loan > purchase price | Warn/error unless financed costs/other structure explicitly supported. |
| Vacancy outside 0–100% | Reject. |
| Interest rate <0 | Reject for MVP. |
| Loan term <=0 | Reject. |

## 11. Golden Verification Cases

| Test | Inputs | Expected |
| --- | --- | --- |
| GT-001 | V=1,040,000; D=524,000 | Equity=516,000; LVR=50.38% displayed. |
| GT-002 | Above + O=50% | Attributable equity=258,000. |
| GT-003 | TTM rent=40,560; V=1,040,000 | Gross live yield=3.90%. |
| GT-004 | R=28,080; OE=11,656; I=14,850 | NOI=16,424; CF before principal=1,574. |
| GT-005 | P=780k; rent=750/week | Annual rent=39k; gross assessment yield=5.00%. |
| GT-006 | P=780k; L=624k | LVR=80.00%; deposit=156k. |
| GT-007 | L=624k; r=6%; 30y; monthly | P&I payment approximately $3,741/month. |
| GT-008 | 39k annual rent; 2% vacancy | 38,220 adjusted rent. |
| GT-009 | V=0 | LVR unavailable, never infinity. |
| GT-010 | OE=NULL | Assessment NOI/net yield/cash flow unavailable. |
| GT-011 | V:1.04m+0.91m; D:524k+410k | Portfolio V=1.95m; D=934k; equity=1.016m; LVR≈47.90%. |
| GT-012 | Promote assessment with $750/week estimated rent | No actual rent transaction is created from estimate. |
| GT-013 | Property tracking_start_date = 4 months ago; 4 months of actual rent transactions exist | CAL-013 gross yield uses the 4-month actual rent, annualised and labelled "Annualised (4 months)" — not treated as unavailable, not padded to a fabricated 12-month TTM. |

## 12. Rounding

Use decimal arithmetic for authoritative money/percentage calculations.
Calculate from unrounded inputs and round final presentation only.
Default percentage display: 2 decimal places.
Periodic loan payment displayed to cents; annual debt service derives from the unrounded payment.
Portfolio totals sum unrounded component values before display rounding.

## 13. Explicitly Deferred

Taxable income, deductibility, tax liability and ATO filing. CGT cost base/taxable capital gain and depreciation. After-tax cash flow. Borrowing capacity/lender approval. Property price-growth forecasts. Personalised investment suitability/buy recommendation. Canonical leveraged total return / IRR / XIRR methodology (OD-08). Advanced risk/probability models and shares/ETF performance calculations.

## 14. Calculation Service Requirements

Implement formulas as deterministic domain functions/services independent of UI. Inputs are typed values plus effective dates/classifications; avoid hidden database lookups inside pure calculation functions. Return value plus diagnostic state such as OK, INCOMPLETE_INPUT, INVALID_INPUT and STALE_INPUT warning. Unit-test every CAL/ASM formula and maintain golden fixtures. Version materially changed calculation definitions for report reproducibility. Do not maintain separate authoritative front-end and server formula implementations.
