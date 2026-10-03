/**
 * Decimal arithmetic helpers (Calculation Spec CP-06 / Architecture ADR-006).
 *
 * All authoritative money/percentage math in the domain layer goes through
 * Decimal — never plain JS `number` arithmetic — to avoid binary
 * floating-point rounding errors on monetary values. `number` is only used
 * at the boundary (contract input/output), never for intermediate math.
 */
import Decimal from "decimal.js";

export type DecimalInput = number | string | Decimal;

export function d(value: DecimalInput): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

/** Round a Decimal to 2dp and return a plain number, for display/output only. */
export function toDisplayNumber(value: Decimal, places = 2): number {
  return value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toNumber();
}

/** Multiply a fraction (0..1) by 100 and round for percentage display. */
export function toPercent(fraction: Decimal, places = 2): number {
  return toDisplayNumber(fraction.mul(100), places);
}

export const ZERO = new Decimal(0);

export function isZero(value: Decimal): boolean {
  return value.isZero();
}
