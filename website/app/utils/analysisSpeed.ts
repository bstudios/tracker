import { toMillisTimestamp } from "./dateTime";

/**
 * Position-derived speed maths for the analysis page.
 *
 * This used to live in SQL — a `points` → `points_with_previous` (a `LAG(...)` window) →
 * `segments` → `ranked_segments` (`NTILE(100)`) CTE chain that the loader executed three
 * separate times per request, reading hundreds of thousands of rows out of D1 for a day
 * that only holds ~10k points. The maths is per-row arithmetic over rows the loader
 * already has in memory, so it is done here instead and the day's points are read once.
 *
 * Everything below is a deliberate transcription of that SQL, constants and all, so the
 * numbers users see (chart, route colouring, summary stats, outlier filtering) are the
 * ones they saw before.
 */

/** Metres per degree of latitude, as used by the original SQL distance expression. */
const METERS_PER_DEGREE_LATITUDE = 111320.0;

/** Degrees → radians, hard coded to the same literal the SQL used. */
const DEGREES_TO_RADIANS = 0.01745329252;

/** m/s → mph, hard coded to the same literal the SQL used. */
const METERS_PER_SECOND_TO_MPH = 2.2369362921;

/** SQLite's `NTILE(100)`: the analysis percentile buckets. */
const PERCENTILE_BUCKET_COUNT = 100;

export type AnalysisPoint = {
  id: number;
  timestamp: number;
  latitude: number;
  longitude: number;
};

export type AnalysisSegment = {
  id: string;
  pointId: number;
  timestamp: number;
  previousLatitude: number;
  previousLongitude: number;
  latitude: number;
  longitude: number;
  timeDeltaSeconds: number;
  distanceMeters: number;
  speedMps: number;
  speedMph: number;
};

/**
 * Equirectangular ("flat earth") distance between two fixes, in metres.
 *
 * Transcribed from the SQL: latitude degrees scale by a fixed metres-per-degree, longitude
 * degrees by the same figure shrunk by the cosine of the pair's mean latitude. Over the
 * handful of metres between consecutive GPS fixes this is indistinguishable from a proper
 * haversine, and it is what the stored numbers have always been computed with.
 */
export const segmentDistanceMeters = (
  previousLatitude: number,
  previousLongitude: number,
  latitude: number,
  longitude: number,
) => {
  const latitudeMeters =
    (latitude - previousLatitude) * METERS_PER_DEGREE_LATITUDE;
  const longitudeMeters =
    (longitude - previousLongitude) *
    (METERS_PER_DEGREE_LATITUDE *
      Math.cos(((latitude + previousLatitude) / 2.0) * DEGREES_TO_RADIANS));

  return Math.sqrt(
    latitudeMeters * latitudeMeters + longitudeMeters * longitudeMeters,
  );
};

/**
 * Seconds between two stored timestamps.
 *
 * The SQL classified the *current* row's magnitude (micros / millis / seconds) and divided
 * the raw difference by that one scale. Normalising each timestamp on its own via
 * `toMillisTimestamp` is equivalent whenever both rows share a magnitude class — which is
 * every ordinary day's data — and strictly more correct when they don't: a day holding one
 * legacy seconds row followed by a millis row produced a wildly wrong delta under the old
 * per-row-of-the-pair classification, and produces the real elapsed time here.
 */
export const segmentTimeDeltaSeconds = (
  previousTimestamp: number,
  timestamp: number,
) =>
  (toMillisTimestamp(timestamp) - toMillisTimestamp(previousTimestamp)) / 1000;

/**
 * Pair each point with its predecessor and derive the per-segment maths, mirroring the
 * `points_with_previous` → `segments` CTEs.
 *
 * Ordering matches the old window frame's `ORDER BY timestamp, id` exactly, so the pairing
 * is deterministic even where several fixes share a timestamp.
 */
export const buildSpeedSegments = (
  points: ReadonlyArray<AnalysisPoint>,
): AnalysisSegment[] => {
  const ordered = [...points].sort(
    (left, right) => left.timestamp - right.timestamp || left.id - right.id,
  );

  const segments: AnalysisSegment[] = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const point = ordered[index];

    const timeDeltaSeconds = segmentTimeDeltaSeconds(
      previous.timestamp,
      point.timestamp,
    );
    const distanceMeters = segmentDistanceMeters(
      previous.latitude,
      previous.longitude,
      point.latitude,
      point.longitude,
    );
    const speedMps =
      timeDeltaSeconds > 0 ? distanceMeters / timeDeltaSeconds : 0;

    segments.push({
      id: `${previous.id}-${point.id}`,
      pointId: point.id,
      timestamp: point.timestamp,
      previousLatitude: previous.latitude,
      previousLongitude: previous.longitude,
      latitude: point.latitude,
      longitude: point.longitude,
      timeDeltaSeconds,
      distanceMeters,
      speedMps,
      speedMph: speedMps * METERS_PER_SECOND_TO_MPH,
    });
  }

  return segments;
};

/**
 * How many rows fall in buckets `1..throughBucket` of an `NTILE(bucketCount)` over
 * `rowCount` rows.
 *
 * SQLite splits the rows into `bucketCount` groups of `floor(rowCount / bucketCount)`,
 * handing one extra row to each of the first `rowCount % bucketCount` groups — so the
 * boundary is *not* `floor(percentile * rowCount)` and the two disagree for most row
 * counts. Reproduced exactly because it decides user-visible thresholds.
 */
export const ntileRowsThroughBucket = (
  rowCount: number,
  bucketCount: number,
  throughBucket: number,
) => {
  if (rowCount <= 0 || throughBucket <= 0) return 0;

  const bucket = Math.min(throughBucket, bucketCount);
  const groupSize = Math.floor(rowCount / bucketCount);
  const oversizedGroups = rowCount % bucketCount;

  return bucket <= oversizedGroups
    ? bucket * (groupSize + 1)
    : oversizedGroups * (groupSize + 1) +
        (bucket - oversizedGroups) * groupSize;
};

export type SpeedThresholds = {
  /**
   * Above this a position-derived segment is treated as GPS jitter and dropped. ~95th
   * percentile of the day's derived speeds with headroom, clamped to a sane band.
   */
  outlierThresholdMph: number;
  /** ~99th percentile of the day's derived speeds; caps the chart's Y axis. */
  chartSpeedCapMph: number;
};

/**
 * The `ranked_segments` percentile thresholds, mirroring the two correlated subqueries the
 * summary row used to run (`MAX(speed_mph) WHERE speed_percentile_bucket <= 95 / <= 99`,
 * each falling back to the overall maximum and then to zero).
 */
export const computeSpeedThresholds = (
  segments: ReadonlyArray<AnalysisSegment>,
): SpeedThresholds => {
  // `WHERE speed_mps >= 0`, then `NTILE(100) OVER (ORDER BY speed_mps)`.
  const ranked = segments
    .filter((segment) => segment.speedMps >= 0)
    .sort((left, right) => left.speedMps - right.speedMps);

  const maxSpeedMphOverFirst = (rowCount: number) => {
    if (rowCount <= 0) return null;

    let max = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < rowCount; index += 1) {
      max = Math.max(max, ranked[index].speedMph);
    }
    return max;
  };

  const maxSpeedMphThroughBucket = (bucket: number) =>
    maxSpeedMphOverFirst(
      ntileRowsThroughBucket(ranked.length, PERCENTILE_BUCKET_COUNT, bucket),
    );

  const overallMaxSpeedMph = maxSpeedMphOverFirst(ranked.length);

  const percentile95Mph =
    maxSpeedMphThroughBucket(95) ?? overallMaxSpeedMph ?? 0;

  return {
    outlierThresholdMph: Math.min(120.0, Math.max(25.0, percentile95Mph * 1.6)),
    chartSpeedCapMph: maxSpeedMphThroughBucket(99) ?? overallMaxSpeedMph ?? 0,
  };
};
