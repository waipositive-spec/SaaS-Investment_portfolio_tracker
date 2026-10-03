/**
 * Loan repayment math shared by assessment metrics (ASM-xxx) and, later,
 * live liability projections. Pure Decimal arithmetic — no floating point.
 */
import Decimal from "decimal.js";
import { d, DecimalInput } from "../money/decimal";

export type RepaymentType = "IO" | "P_AND_I";
export type RepaymentFrequency = "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";

function periodsPerYear(frequency: RepaymentFrequency): number {
  switch (frequency) {
    case "WEEKLY":
      return 52;
    case "FORTNIGHTLY":
      return 26;
    case "MONTHLY":
      return 12;
    default:
      throw new Error(`Unknown repayment frequency: ${frequency}`);
  }
}

export interface LoanRepaymentInput {
  principal: DecimalInput;
  annualInterestRatePercent: DecimalInput; // e.g. 6 for 6%
  loanTermMonths: number;
  repaymentType: RepaymentType;
  repaymentFrequency: RepaymentFrequency;
}

/**
 * Standard amortising-loan periodic repayment amount.
 * P&I: payment = L * i * (1+i)^N / ((1+i)^N - 1)
 * IO: payment = L * i  (interest only, each period)
 * where i = periodic rate, N = total number of repayment periods over the term.
 */
export function calculatePeriodicRepayment(input: LoanRepaymentInput): Decimal {
  const L = d(input.principal);
  const perYear = periodsPerYear(input.repaymentFrequency);
  const i = d(input.annualInterestRatePercent).div(100).div(perYear);
  const N = Math.round((input.loanTermMonths / 12) * perYear);

  if (input.repaymentType === "IO") {
    return L.mul(i);
  }

  if (i.isZero()) {
    // 0% interest edge case: straight-line principal repayment.
    return L.div(N);
  }

  const onePlusI = new Decimal(1).add(i);
  const factor = onePlusI.pow(N);
  return L.mul(i).mul(factor).div(factor.sub(1));
}

/** Convert a periodic repayment figure to an annual total. */
export function annualiseRepayment(periodicAmount: DecimalInput, frequency: RepaymentFrequency): Decimal {
  return d(periodicAmount).mul(periodsPerYear(frequency));
}
