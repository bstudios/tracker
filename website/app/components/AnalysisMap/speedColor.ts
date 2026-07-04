type RgbColor = [number, number, number];

const PALETTE_STOPS: Array<{ t: number; color: RgbColor }> = [
  { t: 0, color: [124, 58, 237] },
  { t: 0.25, color: [37, 99, 235] },
  { t: 0.5, color: [22, 163, 74] },
  { t: 0.75, color: [245, 158, 11] },
  { t: 1, color: [220, 38, 38] },
];

export type SpeedRange = {
  minMph: number;
  maxMph: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const formatHexChannel = (value: number) =>
  Math.round(value).toString(16).padStart(2, "0");

const rgbToHex = ([red, green, blue]: RgbColor) =>
  `#${formatHexChannel(red)}${formatHexChannel(green)}${formatHexChannel(blue)}`;

export const getSpeedRange = (speedMphValues: number[]): SpeedRange => {
  const validSpeeds = speedMphValues.filter(
    (speedMph) => Number.isFinite(speedMph) && speedMph >= 0,
  );

  if (validSpeeds.length === 0) {
    return { minMph: 0, maxMph: 1 };
  }

  const minMph = Math.min(...validSpeeds);
  const maxMph = Math.max(...validSpeeds);

  if (Math.abs(maxMph - minMph) < 1e-9) {
    return { minMph, maxMph: minMph + 1 };
  }

  return { minMph, maxMph };
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

export const speedToColor = (speedMph: number, speedRange: SpeedRange) => {
  const range = speedRange.maxMph - speedRange.minMph;
  const normalized = range > 0 ? (speedMph - speedRange.minMph) / range : 0;
  return getPaletteColorAt(normalized);
};

export const buildLegendTicks = (speedRange: SpeedRange, tickCount = 5) => {
  if (tickCount < 2) {
    const speedMph = speedRange.minMph;
    return [{ speedMph, color: speedToColor(speedMph, speedRange) }];
  }

  const span = speedRange.maxMph - speedRange.minMph;

  return Array.from({ length: tickCount }, (_, index) => {
    const ratio = index / (tickCount - 1);
    const speedMph = speedRange.minMph + span * ratio;

    return {
      speedMph,
      color: speedToColor(speedMph, speedRange),
    };
  });
};
