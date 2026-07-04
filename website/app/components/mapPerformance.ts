type Coordinate = {
  latitude: number;
  longitude: number;
};

export type CoordinateBounds = [[number, number], [number, number]];

const MIN_LATITUDE = -85;
const MAX_LATITUDE = 85;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

const DEFAULT_MIN_SPAN_DEGREES = 0.02;
const DEFAULT_PADDING_RATIO = 0.2;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const poorNetworkTileLayerDefaults = {
  updateWhenIdle: true,
  updateWhenZooming: false,
  keepBuffer: 1,
} as const;

type TileLayerPerformanceOptions = {
  updateWhenIdle: boolean;
  updateWhenZooming: boolean;
  keepBuffer: number;
  updateInterval: number;
};

type MapPerformanceConfig = {
  centerConstraintPaddingRatio: number;
  zoomOutPaddingRatio: number;
  tileLayer: TileLayerPerformanceOptions;
};

export const mapPerformanceConfig: Record<
  "analysis" | "live",
  MapPerformanceConfig
> = {
  analysis: {
    centerConstraintPaddingRatio: 0.9,
    zoomOutPaddingRatio: 0.25,
    tileLayer: {
      ...poorNetworkTileLayerDefaults,
      updateInterval: 500,
    },
  },
  live: {
    centerConstraintPaddingRatio: 1.1,
    zoomOutPaddingRatio: 0.25,
    tileLayer: {
      ...poorNetworkTileLayerDefaults,
      updateInterval: 500,
    },
  },
};

export const createRestrictedViewportBounds = (
  coordinates: Coordinate[],
  options?: {
    minSpanDegrees?: number;
    paddingRatio?: number;
  },
): CoordinateBounds | undefined => {
  if (coordinates.length === 0) {
    return undefined;
  }

  const minSpanDegrees = options?.minSpanDegrees ?? DEFAULT_MIN_SPAN_DEGREES;
  const paddingRatio = options?.paddingRatio ?? DEFAULT_PADDING_RATIO;

  const initial = {
    minLat: coordinates[0].latitude,
    maxLat: coordinates[0].latitude,
    minLon: coordinates[0].longitude,
    maxLon: coordinates[0].longitude,
  };

  const rawBounds = coordinates.slice(1).reduce((acc, point) => {
    acc.minLat = Math.min(acc.minLat, point.latitude);
    acc.maxLat = Math.max(acc.maxLat, point.latitude);
    acc.minLon = Math.min(acc.minLon, point.longitude);
    acc.maxLon = Math.max(acc.maxLon, point.longitude);
    return acc;
  }, initial);

  const latCenter = (rawBounds.minLat + rawBounds.maxLat) / 2;
  const lonCenter = (rawBounds.minLon + rawBounds.maxLon) / 2;

  const latSpan = Math.max(rawBounds.maxLat - rawBounds.minLat, minSpanDegrees);
  const lonSpan = Math.max(rawBounds.maxLon - rawBounds.minLon, minSpanDegrees);

  const paddedLatHalfSpan = (latSpan * (1 + paddingRatio)) / 2;
  const paddedLonHalfSpan = (lonSpan * (1 + paddingRatio)) / 2;

  const south = clamp(
    latCenter - paddedLatHalfSpan,
    MIN_LATITUDE,
    MAX_LATITUDE,
  );
  const north = clamp(
    latCenter + paddedLatHalfSpan,
    MIN_LATITUDE,
    MAX_LATITUDE,
  );
  const west = clamp(
    lonCenter - paddedLonHalfSpan,
    MIN_LONGITUDE,
    MAX_LONGITUDE,
  );
  const east = clamp(
    lonCenter + paddedLonHalfSpan,
    MIN_LONGITUDE,
    MAX_LONGITUDE,
  );

  return [
    [south, west],
    [north, east],
  ];
};
