type RgbColor = [number, number, number];

const PALETTE_STOPS: Array<{ t: number; color: RgbColor }> = [
  { t: 0, color: [220, 38, 38] },
  { t: 0.5, color: [245, 158, 11] },
  { t: 1, color: [22, 163, 74] },
];

export type SignalRange = {
  minDbm: number;
  maxDbm: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const formatHexChannel = (value: number) =>
  Math.round(value).toString(16).padStart(2, "0");

const rgbToHex = ([red, green, blue]: RgbColor) =>
  `#${formatHexChannel(red)}${formatHexChannel(green)}${formatHexChannel(blue)}`;

export const getSignalRange = (dbmValues: number[]): SignalRange => {
  const validValues = dbmValues.filter((dbm) => Number.isFinite(dbm));

  if (validValues.length === 0) {
    return { minDbm: -110, maxDbm: -50 };
  }

  const minDbm = Math.min(...validValues);
  const maxDbm = Math.max(...validValues);

  if (Math.abs(maxDbm - minDbm) < 1e-9) {
    return { minDbm: minDbm - 1, maxDbm };
  }

  return { minDbm, maxDbm };
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

/** Weaker (more negative) dBm readings are red, stronger readings are green. */
export const signalToColor = (dbm: number, signalRange: SignalRange) => {
  const range = signalRange.maxDbm - signalRange.minDbm;
  const normalized = range > 0 ? (dbm - signalRange.minDbm) / range : 0;
  return getPaletteColorAt(normalized);
};

export const buildSignalLegendTicks = (
  signalRange: SignalRange,
  tickCount = 5,
) => {
  if (tickCount < 2) {
    const dbm = signalRange.minDbm;
    return [{ dbm, color: signalToColor(dbm, signalRange) }];
  }

  const span = signalRange.maxDbm - signalRange.minDbm;

  return Array.from({ length: tickCount }, (_, index) => {
    const ratio = index / (tickCount - 1);
    const dbm = signalRange.minDbm + span * ratio;

    return {
      dbm,
      color: signalToColor(dbm, signalRange),
    };
  });
};
