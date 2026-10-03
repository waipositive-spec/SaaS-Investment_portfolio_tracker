/**
 * Live portfolio position metrics — CAL-001..009 (Calculation Spec §CAL).
 *
 * Pure functions. No I/O, no DB access — callers (Server Actions /
 * repositories) supply already-fetched, already-tenant-scoped data and
 * persist/display the result. Zero-denominator cases (CP-07) are reported
 * as INVALID_INPUT, never as 0 or Infinity.
 */
import { d, ZERO } from "../money/decimal";
import { MetricResult, ok, incomplete, invalid } from "./types";

export interface AssetPositionInput {
  assetId: string;
  /** V — current valuation (any provenance: ACTUAL/ESTIMATE/FORMAL-EXTERNAL-VALUATION). Null if none recorded. */
  valuation: number | null;
  /** D — total outstanding debt secured against/attributed to the asset. Null if unknown. */
  debt: number | null;
  /** O — ownership fraction held by the tenant, 0..1. Null/undefined => treated as 1 (CD rule: default full ownership). */
  ownershipFraction?: number | null;
}

export interface AssetPositionResult {
  assetId: string;
  /** CAL-001: V - D */
  equity: MetricResult;
  /** CAL-002: V * O */
  attributableValue: MetricResult;
  /** CAL-003: D * O */
  attributableDebt: MetricResult;
  /** CAL-004: attributableValue - attributableDebt */
  attributableEquity: MetricResult;
  /** CAL-005: D / V * 100, unavailable (not 0/Infinity) when V is 0 */
  lvr: MetricResult;
}

export function calculateAssetPosition(input: AssetPositionInput): AssetPositionResult {
  const { valuation, debt, ownershipFraction } = input;
  const ownership = ownershipFraction ?? 1;

  const equity: MetricResult =
    valuation == null || debt == null
      ? incomplete(
          [valuation == null ? "valuation" : null, debt == null ? "debt" : null].filter(
            (x): x is string => x !== null,
          ),
        )
      : ok(d(valuation).sub(debt).toDecimalPlaces(2).toNumber());

  const attributableValue: MetricResult =
    valuation == null ? incomplete(["valuation"]) : ok(d(valuation).mul(ownership).toDecimalPlaces(2).toNumber());

  const attributableDebt: MetricResult =
    debt == null ? incomplete(["debt"]) : ok(d(debt).mul(ownership).toDecimalPlaces(2).toNumber());

  const attributableEquity: MetricResult =
    attributableValue.value == null || attributableDebt.value == null
      ? incomplete(
          [
            attributableValue.value == null ? "valuation" : null,
            attributableDebt.value == null ? "debt" : null,
          ].filter((x): x is string => x !== null),
        )
      : ok(d(attributableValue.value).sub(attributableDebt.value).toDecimalPlaces(2).toNumber());

  let lvr: MetricResult;
  if (valuation == null || debt == null) {
    lvr = incomplete(
      [valuation == null ? "valuation" : null, debt == null ? "debt" : null].filter(
        (x): x is string => x !== null,
      ),
    );
  } else if (d(valuation).isZero()) {
    // CP-07: zero denominator => unavailable, never 0 or Infinity.
    lvr = invalid(["valuation (zero — LVR undefined)"]);
  } else {
    lvr = ok(d(debt).div(valuation).mul(100).toDecimalPlaces(2).toNumber());
  }

  return { assetId: input.assetId, equity, attributableValue, attributableDebt, attributableEquity, lvr };
}

export interface PortfolioPositionResult {
  assets: AssetPositionResult[];
  /** CAL-006: sum of V across assets with a known valuation. */
  totalValue: MetricResult;
  /** CAL-007: sum of D across assets with known debt. */
  totalDebt: MetricResult;
  /** CAL-008: totalValue - totalDebt */
  totalEquity: MetricResult;
  /** CAL-009: totalDebt / totalValue * 100, unavailable when totalValue is 0 */
  portfolioLvr: MetricResult;
}

export function calculateLivePortfolioPosition(assets: AssetPositionInput[]): PortfolioPositionResult {
  const assetResults = assets.map(calculateAssetPosition);

  const missingValuation = assets.some((a) => a.valuation == null);
  const missingDebt = assets.some((a) => a.debt == null);

  const totalValue: MetricResult = missingValuation
    ? incomplete(["valuation"])
    : ok(
        assets
          .reduce((sum, a) => sum.add(d(a.valuation as number)), ZERO)
          .toDecimalPlaces(2)
          .toNumber(),
      );

  const totalDebt: MetricResult = missingDebt
    ? incomplete(["debt"])
    : ok(
        assets
          .reduce((sum, a) => sum.add(d(a.debt as number)), ZERO)
          .toDecimalPlaces(2)
          .toNumber(),
      );

  const totalEquity: MetricResult =
    totalValue.value == null || totalDebt.value == null
      ? incomplete(
          [totalValue.value == null ? "valuation" : null, totalDebt.value == null ? "debt" : null].filter(
            (x): x is string => x !== null,
          ),
        )
      : ok(d(totalValue.value).sub(totalDebt.value).toDecimalPlaces(2).toNumber());

  let portfolioLvr: MetricResult;
  if (totalValue.value == null || totalDebt.value == null) {
    portfolioLvr = incomplete(
      [totalValue.value == null ? "valuation" : null, totalDebt.value == null ? "debt" : null].filter(
        (x): x is string => x !== null,
      ),
    );
  } else if (d(totalValue.value).isZero()) {
    portfolioLvr = invalid(["valuation (zero — LVR undefined)"]);
  } else {
    portfolioLvr = ok(d(totalDebt.value).div(totalValue.value).mul(100).toDecimalPlaces(2).toNumber());
  }

  return { assets: assetResults, totalValue, totalDebt, totalEquity, portfolioLvr };
}
