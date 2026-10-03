/**
 * Property Assessment metrics — ASM-001..017 (Calculation Spec §ASM, FR-79).
 *
 * This is the pure calculation engine for the free, unauthenticated
 * Assessment tool. It assumes the caller (API contract layer / zod schema)
 * has already enforced hard validation rules (CD-04/CD-05: vacancy rate in
 * 0..100, interest rate >= 0, loan term > 0) — this module does not
 * re-validate ranges, it only distinguishes "missing" from "present" per
 * CP-02 and reports each metric's own diagnostic status.
 */
import Decimal from "decimal.js";
import { d } from "../money/decimal";
import { MetricResult, ok, incomplete, invalid } from "./types";
import { annualiseRentByFrequency, RentFrequency } from "./period";
import { calculatePeriodicRepayment, annualiseRepayment, RepaymentType, RepaymentFrequency } from "./loanMath";

export interface AssessmentScenarioInput {
  /** AP — advertised/asking price. Null if unknown. */
  askingPrice: number | null;
  /** P — proposed purchase price. Required for most downstream metrics. */
  proposedPurchasePrice: number | null;
  estimatedRent: { amount: number; frequency: RentFrequency } | null;
  /** Vacancy rate as a fraction 0..1 (e.g. 0.02 for 2%). Null if not estimated. */
  vacancyRate: number | null;
  /** OE — estimated annual operating expenses (sum of estimated expense line items). */
  estimatedAnnualOperatingExpenses: number | null;
  /** L — proposed loan amount. */
  proposedLoanAmount: number | null;
  /** r — annual interest rate, percent (e.g. 6 for 6%). */
  interestRatePercent: number | null;
  loanTermMonths: number | null;
  repaymentType: RepaymentType | null;
  repaymentFrequency: RepaymentFrequency | null;
  /** AC — acquisition costs (stamp duty, legal, LMI, etc.), summed. */
  acquisitionCosts: number | null;
  /** Other upfront cash required that is not financed and not already in AC (e.g. immediate works/CapEx). */
  immediateWorksCost: number | null;
}

export interface AssessmentMetricsResult {
  /** ASM-001 */
  priceVsAsking: MetricResult;
  priceVsAskingPercent: MetricResult;
  /** ASM-002 */
  grossRentalYield: MetricResult;
  /** ASM-003 */
  vacancyAdjustedRent: MetricResult;
  /** ASM-004 */
  indicativeNoi: MetricResult;
  /** ASM-005 */
  netYieldBeforeFinance: MetricResult;
  /** ASM-006 */
  proposedLvr: MetricResult;
  /** ASM-007 */
  depositOrPurchaseEquity: MetricResult;
  /** ASM-008 */
  upfrontCashRequired: MetricResult;
  /** ASM-009 */
  ioAnnualInterest: MetricResult;
  /** ASM-010 */
  piPeriodicRepayment: MetricResult;
  /** ASM-011 */
  annualPiDebtService: MetricResult;
  /** ASM-012 */
  ioCashFlowBeforePrincipal: MetricResult;
  /** ASM-013 */
  piCashFlowAfterDebtService: MetricResult;
  /** ASM-014 */
  cashOnCashYield: MetricResult & { cashFlowBasis?: "IO" | "P_AND_I" };
  /** ASM-015 */
  breakEvenRentAnnual: MetricResult;
  breakEvenRentWeekly: MetricResult;
  /** ASM-016 */
  acquisitionCostRatio: MetricResult;
  /** ASM-017 */
  totalAcquisitionCashBasis: MetricResult;
}

export function calculateAssessmentMetrics(input: AssessmentScenarioInput): AssessmentMetricsResult {
  const {
    askingPrice,
    proposedPurchasePrice: P,
    estimatedRent,
    vacancyRate,
    estimatedAnnualOperatingExpenses: OE,
    proposedLoanAmount: L,
    interestRatePercent: r,
    loanTermMonths,
    repaymentType,
    repaymentFrequency,
    acquisitionCosts: AC,
    immediateWorksCost,
  } = input;

  // ASM-001: Price vs Asking
  let priceVsAsking: MetricResult;
  let priceVsAskingPercent: MetricResult;
  if (askingPrice == null || P == null) {
    const missing = [askingPrice == null ? "askingPrice" : null, P == null ? "proposedPurchasePrice" : null].filter(
      (x): x is string => x !== null,
    );
    priceVsAsking = incomplete(missing);
    priceVsAskingPercent = incomplete(missing);
  } else {
    const diff = d(P).sub(askingPrice);
    priceVsAsking = ok(diff.toDecimalPlaces(2).toNumber());
    priceVsAskingPercent = d(askingPrice).isZero()
      ? invalid(["askingPrice (zero — % change undefined)"])
      : ok(diff.div(askingPrice).mul(100).toDecimalPlaces(2).toNumber());
  }

  // Annualised estimated rent (shared by ASM-002/003/004/005).
  const annualRent: Decimal | null = estimatedRent ? annualiseRentByFrequency(estimatedRent.amount, estimatedRent.frequency) : null;

  // ASM-002: Gross Rental Yield
  let grossRentalYield: MetricResult;
  if (annualRent == null || P == null) {
    grossRentalYield = incomplete(
      [annualRent == null ? "estimatedRent" : null, P == null ? "proposedPurchasePrice" : null].filter(
        (x): x is string => x !== null,
      ),
    );
  } else if (d(P).isZero()) {
    grossRentalYield = invalid(["proposedPurchasePrice (zero — yield undefined)"]);
  } else {
    grossRentalYield = ok(annualRent.div(P).mul(100).toDecimalPlaces(2).toNumber());
  }

  // ASM-003: Vacancy-Adjusted Rent
  let vacancyAdjustedRent: MetricResult;
  let vacancyAdjustedRentDecimal: Decimal | null = null;
  if (annualRent == null || vacancyRate == null) {
    vacancyAdjustedRent = incomplete(
      [annualRent == null ? "estimatedRent" : null, vacancyRate == null ? "vacancyRate" : null].filter(
        (x): x is string => x !== null,
      ),
    );
  } else {
    vacancyAdjustedRentDecimal = annualRent.mul(new Decimal(1).sub(vacancyRate));
    vacancyAdjustedRent = ok(vacancyAdjustedRentDecimal.toDecimalPlaces(2).toNumber());
  }

  // ASM-004: Indicative NOI
  let indicativeNoi: MetricResult;
  let indicativeNoiDecimal: Decimal | null = null;
  if (vacancyAdjustedRentDecimal == null || OE == null) {
    indicativeNoi = incomplete(
      [
        vacancyAdjustedRentDecimal == null ? "vacancyAdjustedRent" : null,
        OE == null ? "estimatedAnnualOperatingExpenses" : null,
      ].filter((x): x is string => x !== null),
    );
  } else {
    indicativeNoiDecimal = vacancyAdjustedRentDecimal.sub(OE);
    indicativeNoi = ok(indicativeNoiDecimal.toDecimalPlaces(2).toNumber());
  }

  // ASM-005: Net Yield Before Finance
  let netYieldBeforeFinance: MetricResult;
  if (indicativeNoiDecimal == null || P == null) {
    netYieldBeforeFinance = incomplete(
      [indicativeNoiDecimal == null ? "indicativeNoi" : null, P == null ? "proposedPurchasePrice" : null].filter(
        (x): x is string => x !== null,
      ),
    );
  } else if (d(P).isZero()) {
    netYieldBeforeFinance = invalid(["proposedPurchasePrice (zero — yield undefined)"]);
  } else {
    netYieldBeforeFinance = ok(indicativeNoiDecimal.div(P).mul(100).toDecimalPlaces(2).toNumber());
  }

  // ASM-006: Proposed LVR
  let proposedLvr: MetricResult;
  if (L == null || P == null) {
    proposedLvr = incomplete(
      [L == null ? "proposedLoanAmount" : null, P == null ? "proposedPurchasePrice" : null].filter(
        (x): x is string => x !== null,
      ),
    );
  } else if (d(P).isZero()) {
    proposedLvr = invalid(["proposedPurchasePrice (zero — LVR undefined)"]);
  } else {
    proposedLvr = ok(d(L).div(P).mul(100).toDecimalPlaces(2).toNumber());
  }

  // ASM-007: Deposit / Purchase Equity
  let depositOrPurchaseEquity: MetricResult;
  let depositDecimal: Decimal | null = null;
  if (P == null || L == null) {
    depositOrPurchaseEquity = incomplete(
      [P == null ? "proposedPurchasePrice" : null, L == null ? "proposedLoanAmount" : null].filter(
        (x): x is string => x !== null,
      ),
    );
  } else {
    depositDecimal = d(P).sub(L);
    depositOrPurchaseEquity = ok(depositDecimal.toDecimalPlaces(2).toNumber());
  }

  // ASM-008: Upfront Cash Required = purchase equity + AC + other upfront cash not financed (immediate works)
  let upfrontCashRequired: MetricResult;
  if (depositDecimal == null || AC == null) {
    upfrontCashRequired = incomplete(
      [depositDecimal == null ? "depositOrPurchaseEquity" : null, AC == null ? "acquisitionCosts" : null].filter(
        (x): x is string => x !== null,
      ),
    );
  } else {
    const otherUpfront = immediateWorksCost ?? 0;
    upfrontCashRequired = ok(depositDecimal.add(AC).add(otherUpfront).toDecimalPlaces(2).toNumber());
  }

  // ASM-009: IO Annual Interest = L * r
  let ioAnnualInterest: MetricResult;
  let ioAnnualInterestDecimal: Decimal | null = null;
  if (L == null || r == null) {
    ioAnnualInterest = incomplete(
      [L == null ? "proposedLoanAmount" : null, r == null ? "interestRatePercent" : null].filter(
        (x): x is string => x !== null,
      ),
    );
  } else {
    ioAnnualInterestDecimal = d(L).mul(r).div(100);
    ioAnnualInterest = ok(ioAnnualInterestDecimal.toDecimalPlaces(2).toNumber());
  }

  // ASM-010/011: P&I periodic repayment and annualised debt service.
  let piPeriodicRepayment: MetricResult;
  let annualPiDebtService: MetricResult;
  let annualPiDebtServiceDecimal: Decimal | null = null;
  const loanFieldsPresent = L != null && r != null && loanTermMonths != null && repaymentFrequency != null;
  if (!loanFieldsPresent) {
    const missing = [
      L == null ? "proposedLoanAmount" : null,
      r == null ? "interestRatePercent" : null,
      loanTermMonths == null ? "loanTermMonths" : null,
      repaymentFrequency == null ? "repaymentFrequency" : null,
    ].filter((x): x is string => x !== null);
    piPeriodicRepayment = incomplete(missing);
    annualPiDebtService = incomplete(missing);
  } else {
    const periodic = calculatePeriodicRepayment({
      principal: L as number,
      annualInterestRatePercent: r as number,
      loanTermMonths: loanTermMonths as number,
      repaymentType: "P_AND_I",
      repaymentFrequency: repaymentFrequency as RepaymentFrequency,
    });
    piPeriodicRepayment = ok(periodic.toDecimalPlaces(2).toNumber());
    // ASM-011 uses the unrounded periodic payment, per spec worked example.
    annualPiDebtServiceDecimal = annualiseRepayment(periodic, repaymentFrequency as RepaymentFrequency);
    annualPiDebtService = ok(annualPiDebtServiceDecimal.toDecimalPlaces(2).toNumber());
  }

  // ASM-012: IO Cash Flow Before Principal = Indicative NOI - annual IO interest
  let ioCashFlowBeforePrincipal: MetricResult;
  if (indicativeNoiDecimal == null || ioAnnualInterestDecimal == null) {
    ioCashFlowBeforePrincipal = incomplete(
      [
        indicativeNoiDecimal == null ? "indicativeNoi" : null,
        ioAnnualInterestDecimal == null ? "ioAnnualInterest" : null,
      ].filter((x): x is string => x !== null),
    );
  } else {
    ioCashFlowBeforePrincipal = ok(indicativeNoiDecimal.sub(ioAnnualInterestDecimal).toDecimalPlaces(2).toNumber());
  }

  // ASM-013: P&I Cash Flow After Debt Service = Indicative NOI - annual P&I debt service
  let piCashFlowAfterDebtService: MetricResult;
  let piCashFlowAfterDebtServiceDecimal: Decimal | null = null;
  if (indicativeNoiDecimal == null || annualPiDebtServiceDecimal == null) {
    piCashFlowAfterDebtService = incomplete(
      [
        indicativeNoiDecimal == null ? "indicativeNoi" : null,
        annualPiDebtServiceDecimal == null ? "annualPiDebtService" : null,
      ].filter((x): x is string => x !== null),
    );
  } else {
    piCashFlowAfterDebtServiceDecimal = indicativeNoiDecimal.sub(annualPiDebtServiceDecimal);
    piCashFlowAfterDebtService = ok(piCashFlowAfterDebtServiceDecimal.toDecimalPlaces(2).toNumber());
  }

  // ASM-014: Cash-on-Cash Yield = defined annual cash flow / upfront cash invested * 100.
  // Basis follows the scenario's chosen repaymentType (IO vs P&I); defaults to P&I cash flow when available.
  let cashOnCashYield: MetricResult & { cashFlowBasis?: "IO" | "P_AND_I" } = incomplete(["repaymentType"]);
  const basis: "IO" | "P_AND_I" | null = repaymentType ?? null;
  const cashFlowForCoC =
    basis === "IO" ? ioCashFlowBeforePrincipal.value : basis === "P_AND_I" ? piCashFlowAfterDebtService.value : null;
  if (basis == null) {
    cashOnCashYield = { ...incomplete(["repaymentType"]) };
  } else if (cashFlowForCoC == null || upfrontCashRequired.value == null) {
    cashOnCashYield = {
      ...incomplete(
        [
          cashFlowForCoC == null ? (basis === "IO" ? "ioCashFlowBeforePrincipal" : "piCashFlowAfterDebtService") : null,
          upfrontCashRequired.value == null ? "upfrontCashRequired" : null,
        ].filter((x): x is string => x !== null),
      ),
      cashFlowBasis: basis,
    };
  } else if (d(upfrontCashRequired.value).isZero()) {
    cashOnCashYield = { ...invalid(["upfrontCashRequired (zero — yield undefined)"]), cashFlowBasis: basis };
  } else {
    cashOnCashYield = {
      ...ok(d(cashFlowForCoC).div(upfrontCashRequired.value).mul(100).toDecimalPlaces(2).toNumber()),
      cashFlowBasis: basis,
    };
  }

  // ASM-015: Break-Even Rent = (OE + annual debt service) / occupancy factor
  // Debt service basis follows repaymentType, same as ASM-014.
  const debtServiceForBreakEven =
    basis === "IO" ? ioAnnualInterestDecimal : basis === "P_AND_I" ? annualPiDebtServiceDecimal : null;
  let breakEvenRentAnnual: MetricResult;
  let breakEvenRentWeekly: MetricResult;
  const occupancyFactor = vacancyRate == null ? null : new Decimal(1).sub(vacancyRate);
  if (OE == null || debtServiceForBreakEven == null || occupancyFactor == null) {
    const missing = [
      OE == null ? "estimatedAnnualOperatingExpenses" : null,
      debtServiceForBreakEven == null ? "debtService (repaymentType-dependent)" : null,
      occupancyFactor == null ? "vacancyRate" : null,
    ].filter((x): x is string => x !== null);
    breakEvenRentAnnual = incomplete(missing);
    breakEvenRentWeekly = incomplete(missing);
  } else if (occupancyFactor.isZero()) {
    breakEvenRentAnnual = invalid(["vacancyRate (100% — break-even undefined)"]);
    breakEvenRentWeekly = invalid(["vacancyRate (100% — break-even undefined)"]);
  } else {
    const annual = d(OE).add(debtServiceForBreakEven).div(occupancyFactor);
    breakEvenRentAnnual = ok(annual.toDecimalPlaces(2).toNumber());
    breakEvenRentWeekly = ok(annual.div(52).toDecimalPlaces(2).toNumber());
  }

  // ASM-016: Acquisition Cost Ratio = AC / P * 100
  let acquisitionCostRatio: MetricResult;
  if (AC == null || P == null) {
    acquisitionCostRatio = incomplete(
      [AC == null ? "acquisitionCosts" : null, P == null ? "proposedPurchasePrice" : null].filter(
        (x): x is string => x !== null,
      ),
    );
  } else if (d(P).isZero()) {
    acquisitionCostRatio = invalid(["proposedPurchasePrice (zero — ratio undefined)"]);
  } else {
    acquisitionCostRatio = ok(d(AC).div(P).mul(100).toDecimalPlaces(2).toNumber());
  }

  // ASM-017: Total Acquisition Cash Basis = P + AC + immediate CapEx
  let totalAcquisitionCashBasis: MetricResult;
  if (P == null || AC == null) {
    totalAcquisitionCashBasis = incomplete(
      [P == null ? "proposedPurchasePrice" : null, AC == null ? "acquisitionCosts" : null].filter(
        (x): x is string => x !== null,
      ),
    );
  } else {
    totalAcquisitionCashBasis = ok(d(P).add(AC).add(immediateWorksCost ?? 0).toDecimalPlaces(2).toNumber());
  }

  return {
    priceVsAsking,
    priceVsAskingPercent,
    grossRentalYield,
    vacancyAdjustedRent,
    indicativeNoi,
    netYieldBeforeFinance,
    proposedLvr,
    depositOrPurchaseEquity,
    upfrontCashRequired,
    ioAnnualInterest,
    piPeriodicRepayment,
    annualPiDebtService,
    ioCashFlowBeforePrincipal,
    piCashFlowAfterDebtService,
    cashOnCashYield,
    breakEvenRentAnnual,
    breakEvenRentWeekly,
    acquisitionCostRatio,
    totalAcquisitionCashBasis,
  };
}
