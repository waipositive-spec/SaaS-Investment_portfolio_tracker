/**
 * Live income & cash-flow metrics — CAL-010..016 (Calculation Spec §CAL).
 *
 * Callers are responsible for summing ledger transactions into a single
 * period window, clamped to the asset's tracking_start_date (PER-02), and
 * telling us whether that window is a genuine TTM. We never guess at a
 * period boundary or pad a short history to look like a full year — a
 * short window is annualised and explicitly labelled ANNUALISED_SHORT.
 */
import { d } from "../money/decimal";
import { MetricResult, PeriodisedMetricResult, ok, incomplete, invalid } from "./types";
import { annualise, isGenuineTtm } from "./period";

export interface IncomeCashFlowInput {
  /** R — rental income actually recorded in the queried, tracking-start-clamped window. */
  periodRentalIncome: number;
  /** OE — operating expenses actually recorded in the same window. Null if not yet entered (not the same as a genuine $0). */
  periodOperatingExpenses: number | null;
  /** I — interest paid in the same window. Null if unknown. */
  periodInterest?: number | null;
  /** PR — principal repaid in the same window. Null if unknown. */
  periodPrincipal?: number | null;
  /** Number of days actually covered by the window after tracking_start_date clamping. */
  periodDays: number;
  /** True if the window was clamped short by tracking_start_date (or is otherwise < 365 days). */
  wasClampedShort: boolean;
  /** V — current valuation, for yield metrics. Null if none recorded. */
  valuation: number | null;
}

export interface IncomeCashFlowResult {
  /** CAL-010 */
  rentalIncome: MetricResult;
  /** CAL-011 */
  operatingExpenses: MetricResult;
  /** CAL-012: NOI = R - OE */
  noi: MetricResult;
  /** CAL-013: annualised NOI / V * 100 */
  grossYieldLive: PeriodisedMetricResult;
  /** CAL-014: annualised NOI / V * 100 (net of operating costs, before finance) */
  netYieldBeforeFinance: PeriodisedMetricResult;
  /** CAL-015: R - OE - I, period figure, not annualised */
  cashFlowBeforePrincipal: MetricResult;
  /** CAL-016: R - OE - I - PR, period figure, not annualised */
  cashFlowAfterDebtService: MetricResult;
}

export function calculateLiveIncomeAndCashFlow(input: IncomeCashFlowInput): IncomeCashFlowResult {
  const { periodRentalIncome, periodOperatingExpenses, periodInterest, periodPrincipal, periodDays, wasClampedShort, valuation } =
    input;

  // CAL-010: a recorded sum is always OK, including a genuine 0.
  const rentalIncome: MetricResult = ok(d(periodRentalIncome).toDecimalPlaces(2).toNumber());

  // CAL-011: distinguish "not entered yet" (null) from a genuine $0 of expenses.
  const operatingExpenses: MetricResult =
    periodOperatingExpenses == null ? incomplete(["operatingExpenses"]) : ok(d(periodOperatingExpenses).toDecimalPlaces(2).toNumber());

  const noi: MetricResult =
    operatingExpenses.value == null
      ? incomplete(["operatingExpenses"])
      : ok(d(periodRentalIncome).sub(operatingExpenses.value).toDecimalPlaces(2).toNumber());

  const basis = isGenuineTtm(periodDays, wasClampedShort) ? "TTM" : "ANNUALISED_SHORT";

  let grossYieldLive: PeriodisedMetricResult;
  if (valuation == null) {
    grossYieldLive = { ...invalid(["valuation"]), basis, periodDays };
  } else if (d(valuation).isZero()) {
    grossYieldLive = { ...invalid(["valuation (zero — yield undefined)"]), basis, periodDays };
  } else {
    const annualRent = annualise(periodRentalIncome, periodDays);
    grossYieldLive = {
      ...ok(annualRent.div(valuation).mul(100).toDecimalPlaces(2).toNumber()),
      basis,
      periodDays,
    };
  }

  let netYieldBeforeFinance: PeriodisedMetricResult;
  if (noi.value == null) {
    netYieldBeforeFinance = { ...incomplete(["operatingExpenses"]), basis, periodDays };
  } else if (valuation == null) {
    netYieldBeforeFinance = { ...invalid(["valuation"]), basis, periodDays };
  } else if (d(valuation).isZero()) {
    netYieldBeforeFinance = { ...invalid(["valuation (zero — yield undefined)"]), basis, periodDays };
  } else {
    const annualNoi = annualise(noi.value, periodDays);
    netYieldBeforeFinance = {
      ...ok(annualNoi.div(valuation).mul(100).toDecimalPlaces(2).toNumber()),
      basis,
      periodDays,
    };
  }

  let cashFlowBeforePrincipal: MetricResult;
  if (noi.value == null) {
    cashFlowBeforePrincipal = incomplete(["operatingExpenses"]);
  } else if (periodInterest == null) {
    cashFlowBeforePrincipal = incomplete(["interest"]);
  } else {
    cashFlowBeforePrincipal = ok(d(noi.value).sub(periodInterest).toDecimalPlaces(2).toNumber());
  }

  let cashFlowAfterDebtService: MetricResult;
  if (cashFlowBeforePrincipal.value == null) {
    cashFlowAfterDebtService = incomplete(cashFlowBeforePrincipal.missingInputs ?? ["operatingExpenses", "interest"]);
  } else if (periodPrincipal == null) {
    cashFlowAfterDebtService = incomplete(["principal"]);
  } else {
    cashFlowAfterDebtService = ok(d(cashFlowBeforePrincipal.value).sub(periodPrincipal).toDecimalPlaces(2).toNumber());
  }

  return {
    rentalIncome,
    operatingExpenses,
    noi,
    grossYieldLive,
    netYieldBeforeFinance,
    cashFlowBeforePrincipal,
    cashFlowAfterDebtService,
  };
}
