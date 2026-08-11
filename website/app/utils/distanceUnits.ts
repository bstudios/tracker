export const DISTANCE_UNITS = ["m", "km", "nm", "mi"] as const;
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];

// 1 nautical mile = 1852 m; 1 mile = 1609.344 m.
const METERS_PER_UNIT: Record<DistanceUnit, number> = {
  m: 1,
  km: 1000,
  nm: 1852,
  mi: 1609.344,
};

export const DISTANCE_UNIT_LABELS: Record<DistanceUnit, string> = {
  m: "m",
  km: "km",
  nm: "nm",
  mi: "mi",
};

export const DISTANCE_UNIT_OPTIONS = DISTANCE_UNITS.map((unit) => ({
  value: unit,
  label: DISTANCE_UNIT_LABELS[unit],
}));

export const isDistanceUnit = (value: unknown): value is DistanceUnit =>
  typeof value === "string" &&
  (DISTANCE_UNITS as readonly string[]).includes(value);

export const fromMeters = (valueMeters: number, unit: DistanceUnit) =>
  valueMeters / METERS_PER_UNIT[unit];

/**
 * The cumulative distance column is rendered in several places — the logbook page, the
 * printed/emailed PDF, the plain-text email fallback — that all need to agree on precision,
 * so the formatting lives here once rather than being repeated at each call site.
 */
export const formatDistance = (valueMeters: number, unit: DistanceUnit) => {
  const decimals = unit === "m" ? 0 : 1;
  return `${fromMeters(valueMeters, unit).toFixed(decimals)} ${DISTANCE_UNIT_LABELS[unit]}`;
};
