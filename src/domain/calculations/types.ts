/**
 * Shared diagnostic types for the calculation domain (Calculation Spec CP-02/CP-07).
 *
 * Every metric the calculation services produce carries its own diagnostic
 * status. A null/missing input never silently becomes a 0 in a downstream
 * metric — it propagates as INCOMPLETE_INPUT with the specific missing
 * field(s) named, so the UI can say exactly what's missing rather than
 * showing a misleading number.
 */

export type DiagnosticStatus =
  | "OK"
  | "INCOMPLETE_INPUT" // a required input is null/undefined
  | "INVALID_INPUT" // an input is present but unusable for this metric (e.g. zero denominator)
  | "STALE_INPUT"; // an input exists but is older than the metric's freshness tolerance

export interface MetricResult<T = number> {
  value: T | null;
  status: DiagnosticStatus;
  /** Present when status is INCOMPLETE_INPUT or INVALID_INPUT. */
  missingInputs?: string[];
}

export function ok<T>(value: T): MetricResult<T> {
  return { value, status: "OK" };
}

export function incomplete<T>(missingInputs: string[]): MetricResult<T> {
  return { value: null, status: "INCOMPLETE_INPUT", missingInputs };
}

export function invalid<T>(missingInputs: string[]): MetricResult<T> {
  return { value: null, status: "INVALID_INPUT", missingInputs };
}

export function stale<T>(value: T, missingInputs: string[]): MetricResult<T> {
  return { value, status: "STALE_INPUT", missingInputs };
}

/** Basis used to annualise a sub-annual period observation (Calculation Spec PER-01..06). */
export type AnnualisationBasis = "TTM" | "ANNUALISED_SHORT";

export interface PeriodisedMetricResult extends MetricResult {
  /**
   * TTM when the queried window is a genuine trailing-12-months with no
   * gap before tracking_start_date; ANNUALISED_SHORT when the window is
   * shorter (e.g. clamped by tracking_start_date) and the value has been
   * scaled up to an annual run-rate. Never silently treated as TTM.
   */
  basis?: AnnualisationBasis;
  periodDays?: number;
}
