type RgbColor = [number, number, number];

const PALETTE_STOPS: Array<{ t: number; color: RgbColor }> = [
  { t: 0, color: [220, 38, 38] },
  { t: 0.5, color: [245, 158, 11] },
  { t: 1, color: [22, 163, 74] },
];

export type SpeedRange = {
  min: number;
  max: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const formatHexChannel = (value: number) =>
  Math.round(value).toString(16).padStart(2, "0");

const rgbToHex = ([red, green, blue]: RgbColor) =>
  `#${formatHexChannel(red)}${formatHexChannel(green)}${formatHexChannel(blue)}`;

export const getSpeedRange = (speedValues: number[]): SpeedRange => {
  const validSpeeds = speedValues.filter(
    (speedValue) => Number.isFinite(speedValue) && speedValue >= 0,
  );

  if (validSpeeds.length === 0) {
    return { min: 0, max: 1 };
  }

  const min = Math.min(...validSpeeds);
  const max = Math.max(...validSpeeds);

  if (Math.abs(max - min) < 1e-9) {
    return { min, max: min + 1 };
  }

  return { min, max };
};

const interpolateRgb = (
  start: RgbColor,
  end: RgbColor,
  t: number,
): RgbColor => [
  start[0] + (end[0] - start[0]) * t,
  start[1] + (end[1] - start[1]) * t,
  start[2] + (end[2] - start[2]) * t,
];

const getPaletteColorAt = (normalizedValue: number) => {
  const t = clamp01(normalizedValue);

  for (let i = 1; i < PALETTE_STOPS.length; i += 1) {
    const left = PALETTE_STOPS[i - 1];
    const right = PALETTE_STOPS[i];

    if (t <= right.t) {
      const segmentSpan = right.t - left.t || 1;
      const localT = (t - left.t) / segmentSpan;
      return rgbToHex(interpolateRgb(left.color, right.color, localT));
    }
  }

  return rgbToHex(PALETTE_STOPS[PALETTE_STOPS.length - 1].color);
};

export const speedToColor = (speedValue: number, speedRange: SpeedRange) => {
  const range = speedRange.max - speedRange.min;
  const normalized = range > 0 ? (speedValue - speedRange.min) / range : 0;
  return getPaletteColorAt(normalized);
};

export const buildLegendTicks = (speedRange: SpeedRange, tickCount = 5) => {
  if (tickCount < 2) {
    const speedValue = speedRange.min;
    return [{ speedValue, color: speedToColor(speedValue, speedRange) }];
  }

  const span = speedRange.max - speedRange.min;

  return Array.from({ length: tickCount }, (_, index) => {
    const ratio = index / (tickCount - 1);
    const speedValue = speedRange.min + span * ratio;

    return {
      speedValue,
      color: speedToColor(speedValue, speedRange),
    };
  });
};
