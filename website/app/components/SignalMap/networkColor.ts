/**
 * Categorical colours for distinct mobile networks. Unlike signalColor.ts's gradient, each
 * network gets a fixed, visually distinct colour rather than one interpolated from a range.
 */
const NETWORK_PALETTE = [
  "#1971c2", // blue
  "#e8590c", // orange
  "#2f9e44", // green
  "#e64980", // pink
  "#7048e8", // violet
  "#f08c00", // amber
  "#0c8599", // cyan
  "#c2255c", // grape
  "#5c940d", // lime
  "#495057", // gray
];

/** Assigns each distinct network key a stable colour, in first-seen order. */
export const assignNetworkColors = (
  networkKeysInOrder: string[],
): Map<string, string> => {
  const colorByNetworkKey = new Map<string, string>();

  for (const key of networkKeysInOrder) {
    if (colorByNetworkKey.has(key)) continue;
    const color =
      NETWORK_PALETTE[colorByNetworkKey.size % NETWORK_PALETTE.length];
    colorByNetworkKey.set(key, color);
  }

  return colorByNetworkKey;
};
