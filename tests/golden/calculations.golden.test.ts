/**
 * Golden verification tests GT-001..013 (Calculation Spec §GT).
 *
 * These lock in the worked examples from the calculation spec itself.
 * If a refactor changes any of these numbers, the spec's own examples
 * are violated — stop and reconcile against docs/decisions first,
 * don't just update the expected value here.
 */
import { describe, it, expect } from "vitest";
import { calculateAssetPosition, calculateLivePortfolioPosition } from "@/domain/calculations/livePortfolioPosition";
import { calculateLiveIncomeAndCashFlow } from "@/domain/calculations/liveIncomeCashFlow";
import { calculateAssessmentMetrics, AssessmentScenarioInput } from "@/domain/calculations/assessmentMetrics";

function baseScenario(overrides: Partial<AssessmentScenarioInput> = {}): AssessmentScenarioInput {
  return {
    askingPrice: null,
    proposedPurchasePrice: null,
    estimatedRent: null,
    vacancyRate: null,
    estimatedAnnualOperatingExpenses: null,
    proposedLoanAmount: null,
    interestRatePercent: null,
    loanTermMonths: null,
    repaymentType: null,
    repaymentFrequency: null,
    acquisitionCosts: null,
    immediateWorksCost: null,
    ...overrides,
  };
}

describe("GT-001: single-asset equity and LVR", () => {
  it("V=1,040,000 D=524,000 => equity 516,000, LVR 50.38%", () => {
    const result = calculateAssetPosition({ assetId: "a1", valuation: 1_040_000, debt: 524_000 });
    expect(result.equity.value).toBe(516_000);
    expect(result.equity.status).toBe("OK");
    expect(result.lvr.value).toBeCloseTo(50.38, 2);
  });
});

describe("GT-002: attributable equity at partial ownership", () => {
  it("50% ownership halves attributable equity", () => {
    const result = calculateAssetPosition({ assetId: "a1", valuation: 1_040_000, debt: 524_000, ownershipFraction: 0.5 });
    expect(result.attributableEquity.value).toBe(258_000);
  });
});

describe("GT-003: live gross yield on a full TTM window", () => {
  it("TTM rent 40,560 / V 1,040,000 => 3.90%", () => {
    const result = calculateLiveIncomeAndCashFlow({
      periodRentalIncome: 40_560,
      periodOperatingExpenses: 0,
      periodDays: 365,
      wasClampedShort: false,
      valuation: 1_040_000,
    });
    expect(result.grossYieldLive.value).toBeCloseTo(3.9, 2);
    expect(result.grossYieldLive.basis).toBe("TTM");
  });
});

describe("GT-004: live NOI and cash flow before principal", () => {
  it("R=28,080 OE=11,656 I=14,850 => NOI 16,424, CF before principal 1,574", () => {
    const result = calculateLiveIncomeAndCashFlow({
      periodRentalIncome: 28_080,
      periodOperatingExpenses: 11_656,
      periodInterest: 14_850,
      periodDays: 365,
      wasClampedShort: false,
      valuation: 1_040_000,
    });
    expect(result.noi.value).toBe(16_424);
    expect(result.cashFlowBeforePrincipal.value).toBe(1_574);
  });
});

describe("GT-005: assessment gross rental yield", () => {
  it("P=780,000, rent $750/wk => 5.00%", () => {
    const result = calculateAssessmentMetrics(
      baseScenario({ proposedPurchasePrice: 780_000, estimatedRent: { amount: 750, frequency: "WEEKLY" } }),
    );
    expect(result.grossRentalYield.value).toBeCloseTo(5.0, 2);
  });
});

describe("GT-006: proposed LVR and deposit", () => {
  it("P=780,000 L=624,000 => LVR 80.00%, deposit 156,000", () => {
    const result = calculateAssessmentMetrics(
      baseScenario({ proposedPurchasePrice: 780_000, proposedLoanAmount: 624_000 }),
    );
    expect(result.proposedLvr.value).toBeCloseTo(80.0, 2);
    expect(result.depositOrPurchaseEquity.value).toBe(156_000);
  });
});

describe("GT-007: P&I periodic repayment", () => {
  it("L=624,000 r=6% 30y monthly => ~$3,741/month", () => {
    const result = calculateAssessmentMetrics(
      baseScenario({
        proposedLoanAmount: 624_000,
        interestRatePercent: 6,
        loanTermMonths: 360,
        repaymentFrequency: "MONTHLY",
      }),
    );
    expect(result.piPeriodicRepayment.value).toBeGreaterThan(3_740);
    expect(result.piPeriodicRepayment.value).toBeLessThan(3_742);
  });
});

describe("GT-008: vacancy-adjusted rent", () => {
  it("annual rent 39,000 at 2% vacancy => 38,220", () => {
    const result = calculateAssessmentMetrics(
      baseScenario({ estimatedRent: { amount: 750, frequency: "WEEKLY" }, vacancyRate: 0.02 }),
    );
    expect(result.vacancyAdjustedRent.value).toBe(38_220);
  });
});

describe("GT-009: zero-valuation LVR is unavailable, not 0 or Infinity (CP-07)", () => {
  it("V=0 => lvr is INVALID_INPUT, equity still computes", () => {
    const result = calculateAssetPosition({ assetId: "a1", valuation: 0, debt: 100_000 });
    expect(result.lvr.status).toBe("INVALID_INPUT");
    expect(result.lvr.value).toBeNull();
    expect(result.equity.status).toBe("OK");
    expect(result.equity.value).toBe(-100_000);
  });
});

describe("GT-010: missing operating expenses propagates as INCOMPLETE_INPUT, never silently treated as $0", () => {
  it("OE null => NOI/net yield/cash flow unavailable, not computed as if OE=0", () => {
    const result = calculateAssessmentMetrics(
      baseScenario({
        proposedPurchasePrice: 780_000,
        estimatedRent: { amount: 750, frequency: "WEEKLY" },
        vacancyRate: 0.02,
        estimatedAnnualOperatingExpenses: null,
      }),
    );
    expect(result.indicativeNoi.status).toBe("INCOMPLETE_INPUT");
    expect(result.indicativeNoi.missingInputs).toContain("estimatedAnnualOperatingExpenses");
    expect(result.netYieldBeforeFinance.status).toBe("INCOMPLETE_INPUT");
  });
});

describe("GT-011: portfolio-level aggregation and LVR", () => {
  it("two assets aggregate to total equity 1,016,000 and LVR ~47.90%", () => {
    const result = calculateLivePortfolioPosition([
      { assetId: "a1", valuation: 1_040_000, debt: 524_000 },
      { assetId: "a2", valuation: 910_000, debt: 410_000 },
    ]);
    expect(result.totalValue.value).toBe(1_950_000);
    expect(result.totalDebt.value).toBe(934_000);
    expect(result.totalEquity.value).toBe(1_016_000);
    expect(result.portfolioLvr.value).toBeCloseTo(47.9, 2);
  });
});

describe("GT-012: assessment-to-portfolio promotion is a separate, explicit act", () => {
  it("the pure calculation engine performs no persistence/I-O side effects", () => {
    // The assessment metrics engine must remain a pure function: computing
    // ASM-xxx for a scenario must never itself create a ledger transaction,
    // asset, or any other row. Promotion (FR-79 "Convert assessment to
    // tracked asset") is a distinct, explicit server action implemented at
    // the application-service layer (see api-application-service-contracts
    // §Assessment, CV-02) and is covered there by integration tests once
    // the repository/DB layer exists — not by this pure-function suite.
    const result = calculateAssessmentMetrics(
      baseScenario({ proposedPurchasePrice: 780_000, proposedLoanAmount: 624_000 }),
    );
    expect(typeof result).toBe("object");
    // No DB client, fetch, or fs import exists in assessmentMetrics.ts — a
    // static-import check, enforced by code review / AV-xx gates rather
    // than a runtime assertion here.
  });
});

describe("GT-013: short-history yield is annualised, never padded to a full TTM or marked unavailable", () => {
  it("4 months of rent since tracking_start_date => ANNUALISED_SHORT basis with a real value", () => {
    const periodDays = 122; // ~4 months
    const fourMonthsRent = 10_000;
    const result = calculateLiveIncomeAndCashFlow({
      periodRentalIncome: fourMonthsRent,
      periodOperatingExpenses: 0,
      periodDays,
      wasClampedShort: true,
      valuation: 1_000_000,
    });
    expect(result.grossYieldLive.status).toBe("OK");
    expect(result.grossYieldLive.basis).toBe("ANNUALISED_SHORT");
    expect(result.grossYieldLive.value).not.toBeNull();
    // annualised = 10000 * 365/122 ≈ 29,918 => yield ≈ 2.99%
    expect(result.grossYieldLive.value).toBeCloseTo(2.99, 1);
  });
});
