/**
 * Period annualisation helpers (Calculation Spec PER-01..06).
 */
import Decimal from "decimal.js";
import { d, DecimalInput } from "../money/decimal";

export const DAYS_PER_YEAR = 365;

/** PER-03: scale a period amount up to an annual run-rate. amount * 365 / periodDays. */
export function annualise(amount: DecimalInput, periodDays: number): Decimal {
  if (periodDays <= 0) {
    throw new Error("periodDays must be > 0 to annualise");
  }
  return d(amount).mul(DAYS_PER_YEAR).div(periodDays);
}

/** PER-01: a window counts as a genuine TTM only when it covers a full 365 days with no clamp. */
export function isGenuineTtm(periodDays: number, wasClampedByTrackingStart: boolean): boolean {
  return periodDays >= DAYS_PER_YEAR && !wasClampedByTrackingStart;
}

export type RentFrequency = "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "ANNUALLY";

/** PER-04: convert a quoted rent amount at a given frequency to an annual figure. */
export function annualiseRentByFrequency(amount: DecimalInput, frequency: RentFrequency): Decimal {
  const amt = d(amount);
  switch (frequency) {
    case "WEEKLY":
      return amt.mul(52);
    case "FORTNIGHTLY":
      return amt.mul(26);
    case "MONTHLY":
      return amt.mul(12);
    case "ANNUALLY":
      return amt;
    default:
      throw new Error(`Unknown rent frequency: ${frequency}`);
  }
}

/** Whole days between two UTC dates (end - start), inclusive-exclusive. */
export function daysBetween(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((end.getTime() - start.getTime()) / msPerDay);
}

/**
 * PER-02: clamp a requested period's start to tracking_start_date. Returns the
 * effective start and whether clamping occurred (meaning any "annualised"
 * figure derived from this window must be labelled ANNUALISED_SHORT, not TTM).
 */
export function clampPeriodStart(
  requestedStart: Date,
  trackingStartDate: Date | null,
): { effectiveStart: Date; wasClamped: boolean } {
  if (trackingStartDate && trackingStartDate.getTime() > requestedStart.getTime()) {
    return { effectiveStart: trackingStartDate, wasClamped: true };
  }
  return { effectiveStart: requestedStart, wasClamped: false };
}
