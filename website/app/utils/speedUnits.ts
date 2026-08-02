export const SPEED_UNITS = ["mps", "kmh", "kts", "mph"] as const;
export type SpeedUnit = (typeof SPEED_UNITS)[number];

// 1 knot = 1 nautical mile (1852 m) per hour; 1 mph = 1609.344 m per hour.
const METERS_PER_SECOND_PER_UNIT: Record<SpeedUnit, number> = {
  mps: 1,
  kmh: 1 / 3.6,
  kts: 1852 / 3600,
  mph: 1609.344 / 3600,
};

export const SPEED_UNIT_LABELS: Record<SpeedUnit, string> = {
  mps: "m/s",
  kmh: "km/h",
  kts: "knots",
  mph: "mph",
};

export const SPEED_UNIT_OPTIONS = SPEED_UNITS.map((unit) => ({
  value: unit,
  label: SPEED_UNIT_LABELS[unit],
}));

export const isSpeedUnit = (value: unknown): value is SpeedUnit =>
  typeof value === "string" &&
  (SPEED_UNITS as readonly string[]).includes(value);

export const toMetersPerSecond = (value: number, unit: SpeedUnit) =>
  value * METERS_PER_SECOND_PER_UNIT[unit];

export const fromMetersPerSecond = (valueMps: number, unit: SpeedUnit) =>
  valueMps / METERS_PER_SECOND_PER_UNIT[unit];
