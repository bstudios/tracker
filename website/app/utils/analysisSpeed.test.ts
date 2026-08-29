import { describe, expect, it } from "vitest";
import {
  buildSpeedSegments,
  computeSpeedThresholds,
  ntileRowsThroughBucket,
  segmentDistanceMeters,
  segmentTimeDeltaSeconds,
  type AnalysisPoint,
} from "./analysisSpeed";
import sqlFixture from "./__fixtures__/analysisSpeedSql.json";

/**
 * These functions replaced a SQL CTE chain that the analysis loader used to run three
 * times per request. The numbers are user visible (speed chart, route colouring, summary
 * stats, outlier filtering), so the primary test is a differential one: the fixture in
 * `__fixtures__/analysisSpeedSql.json` holds the *original* SQL's own output, produced by
 * running it against real SQLite (see the generator script alongside it), and the JS is
 * asserted to reproduce it.
 */

type SqlCase = {
  points: AnalysisPoint[];
  expected: {
    segments: Array<{
      id: string;
      pointId: number;
      timestamp: number;
      timeDeltaSeconds: number;
      distanceMeters: number;
      speedMps: number;
      speedMph: number;
    }>;
    summary: {
      points: number;
      outlierThresholdMph: number;
      chartSpeedCapMph: number;
    } | null;
  };
};

const cases = sqlFixture.cases as Record<string, SqlCase>;

/**
 * The one case where the rewrite deliberately differs from the SQL: the old expression
 * classified the magnitude of the *later* timestamp and divided the raw difference by that
 * single scale, which is nonsense when a legacy seconds row is followed by a millis row.
 * Asserted explicitly further down instead.
 */
const INTENTIONAL_DIVERGENCE = new Set(["mixedMagnitudeTimestamps"]);

describe("matches the original SQL", () => {
  for (const [name, sqlCase] of Object.entries(cases)) {
    if (INTENTIONAL_DIVERGENCE.has(name)) continue;

    it(`${name} (${sqlCase.points.length} points)`, () => {
      const segments = buildSpeedSegments(sqlCase.points);

      expect(segments).toHaveLength(sqlCase.expected.segments.length);

      segments.forEach((segment, index) => {
        const expected = sqlCase.expected.segments[index];
        expect(segment.id).toBe(expected.id);
        expect(segment.pointId).toBe(expected.pointId);
        expect(segment.timestamp).toBe(expected.timestamp);

        // The fixture does not repeat the coordinates (they are copies of the input
        // points); `id` pins which pair produced the segment, and the distance below
        // would not match if either end had been taken from the wrong row.
        const [previousPointId] = expected.id.split("-").map(Number);
        const previousPoint = sqlCase.points.find(
          (point) => point.id === previousPointId,
        );
        expect(segment.previousLatitude).toBe(previousPoint?.latitude);
        expect(segment.previousLongitude).toBe(previousPoint?.longitude);

        expect(segment.timeDeltaSeconds).toBeCloseTo(
          expected.timeDeltaSeconds,
          9,
        );
        expect(segment.distanceMeters).toBeCloseTo(expected.distanceMeters, 6);
        expect(segment.speedMps).toBeCloseTo(expected.speedMps, 9);
        expect(segment.speedMph).toBeCloseTo(expected.speedMph, 9);
      });

      // `walk0` has no points at all, so the SQL's `FROM points LIMIT 1` produced no row
      // and the loader fell back to its own defaults; there is nothing to compare.
      if (sqlCase.expected.summary === null) {
        expect(sqlCase.points).toHaveLength(0);
        return;
      }

      const thresholds = computeSpeedThresholds(segments);
      expect(thresholds.outlierThresholdMph).toBeCloseTo(
        sqlCase.expected.summary.outlierThresholdMph,
        9,
      );
      expect(thresholds.chartSpeedCapMph).toBeCloseTo(
        sqlCase.expected.summary.chartSpeedCapMph,
        9,
      );
    });
  }
});

describe("ntileRowsThroughBucket", () => {
  it("splits rows the way SQLite's NTILE does", () => {
    // 253 rows over 100 buckets: 53 buckets of 3 followed by 47 of 2.
    expect(ntileRowsThroughBucket(253, 100, 1)).toBe(3);
    expect(ntileRowsThroughBucket(253, 100, 53)).toBe(159);
    expect(ntileRowsThroughBucket(253, 100, 54)).toBe(161);
    expect(ntileRowsThroughBucket(253, 100, 95)).toBe(243);
    expect(ntileRowsThroughBucket(253, 100, 100)).toBe(253);
  });

  it("gives every row its own bucket when there are fewer rows than buckets", () => {
    expect(ntileRowsThroughBucket(7, 100, 95)).toBe(7);
    expect(ntileRowsThroughBucket(7, 100, 3)).toBe(3);
  });

  it("disagrees with a naive floor(p * n) percentile, which is the point", () => {
    // 253 rows: naive 95th percentile would take 240 rows, NTILE takes 243.
    expect(ntileRowsThroughBucket(253, 100, 95)).not.toBe(
      Math.floor(0.95 * 253),
    );
  });

  it("handles empty and degenerate inputs", () => {
    expect(ntileRowsThroughBucket(0, 100, 95)).toBe(0);
    expect(ntileRowsThroughBucket(10, 100, 0)).toBe(0);
    expect(ntileRowsThroughBucket(10, 100, 500)).toBe(10);
  });
});

describe("buildSpeedSegments", () => {
  const point = (
    id: number,
    timestamp: number,
    latitude = 51.5,
    longitude = -0.12,
  ): AnalysisPoint => ({ id, timestamp, latitude, longitude });

  it("produces no segments for zero or one point", () => {
    expect(buildSpeedSegments([])).toEqual([]);
    expect(buildSpeedSegments([point(1, 1_756_339_200_000)])).toEqual([]);
  });

  it("produces one segment for two points", () => {
    const segments = buildSpeedSegments([
      point(1, 1_756_339_200_000, 51.5, -0.12),
      point(2, 1_756_339_205_000, 51.5009, -0.12),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0].id).toBe("1-2");
    expect(segments[0].pointId).toBe(2);
    expect(segments[0].timeDeltaSeconds).toBe(5);
    // 0.0009 degrees of latitude at 111320 m/degree.
    expect(segments[0].distanceMeters).toBeCloseTo(100.188, 3);
    expect(segments[0].speedMps).toBeCloseTo(20.0376, 4);
    expect(segments[0].speedMph).toBeCloseTo(20.0376 * 2.2369362921, 4);
  });

  it("treats duplicate timestamps as a zero-length, zero-speed segment", () => {
    const segments = buildSpeedSegments([
      point(1, 1_756_339_200_000, 51.5, -0.12),
      point(2, 1_756_339_200_000, 51.6, -0.12),
    ]);

    expect(segments[0].timeDeltaSeconds).toBe(0);
    expect(segments[0].distanceMeters).toBeGreaterThan(0);
    // A zero delta must not divide; the SQL guarded this the same way.
    expect(segments[0].speedMps).toBe(0);
    expect(segments[0].speedMph).toBe(0);
  });

  it("orders by timestamp then id, matching the old LAG window frame", () => {
    const segments = buildSpeedSegments([
      point(9, 1_756_339_205_000),
      point(4, 1_756_339_200_000),
      point(2, 1_756_339_200_000),
    ]);

    expect(segments.map((segment) => segment.id)).toEqual(["2-4", "4-9"]);
  });

  it("spans a UTC day boundary without a discontinuity", () => {
    const midnight = Date.UTC(2026, 7, 29, 0, 0, 0);
    const segments = buildSpeedSegments([
      point(1, midnight - 2000),
      point(2, midnight, 51.5009, -0.12),
      point(3, midnight + 3000, 51.5018, -0.12),
    ]);

    expect(segments.map((segment) => segment.timeDeltaSeconds)).toEqual([2, 3]);
    expect(segments[0].distanceMeters).toBeCloseTo(
      segments[1].distanceMeters,
      3,
    );
  });

  it("normalises seconds, milliseconds and microseconds alike", () => {
    const seconds = buildSpeedSegments([
      point(1, 1_756_339_200),
      point(2, 1_756_339_205, 51.5009, -0.12),
    ]);
    const millis = buildSpeedSegments([
      point(1, 1_756_339_200_000),
      point(2, 1_756_339_205_000, 51.5009, -0.12),
    ]);
    const micros = buildSpeedSegments([
      point(1, 1_756_339_200_000_000),
      point(2, 1_756_339_205_000_000, 51.5009, -0.12),
    ]);

    expect(seconds[0].timeDeltaSeconds).toBe(5);
    expect(millis[0].timeDeltaSeconds).toBe(5);
    expect(micros[0].timeDeltaSeconds).toBeCloseTo(5, 6);
    expect(seconds[0].speedMps).toBeCloseTo(millis[0].speedMps, 9);
    expect(micros[0].speedMps).toBeCloseTo(millis[0].speedMps, 6);
  });

  it("resolves a seconds row followed by a millis row to the real elapsed time", () => {
    const { points } = cases.mixedMagnitudeTimestamps;
    const segments = buildSpeedSegments(points);

    // 1756339200s and 1756339205000ms are 5 seconds apart in reality. The SQL classified
    // the later (millis) row and divided the raw difference by 1000, inventing a delta of
    // ~1.75e9 seconds (55 years); the JS normalises each timestamp on its own instead.
    expect(segments[0].timeDeltaSeconds).toBe(5);
    expect(
      cases.mixedMagnitudeTimestamps.expected.segments[0].timeDeltaSeconds,
    ).toBeCloseTo(1_754_582_865.8, 1);

    // The following millis-to-millis segment was never affected either way.
    expect(segments[1].timeDeltaSeconds).toBe(7);
    expect(
      cases.mixedMagnitudeTimestamps.expected.segments[1].timeDeltaSeconds,
    ).toBe(7);
  });
});

describe("segmentDistanceMeters", () => {
  it("scales latitude by a fixed metres-per-degree", () => {
    expect(segmentDistanceMeters(51.5, -0.12, 51.501, -0.12)).toBeCloseTo(
      111.32,
      6,
    );
  });

  it("shrinks longitude by the cosine of the mean latitude", () => {
    expect(segmentDistanceMeters(51.5, -0.12, 51.5, -0.119)).toBeCloseTo(
      111.32 * Math.cos(51.5 * 0.01745329252),
      6,
    );
  });

  it("is zero for an unmoved point and symmetric", () => {
    expect(segmentDistanceMeters(51.5, -0.12, 51.5, -0.12)).toBe(0);
    expect(segmentDistanceMeters(51.5, -0.12, 51.51, -0.13)).toBeCloseTo(
      segmentDistanceMeters(51.51, -0.13, 51.5, -0.12),
      6,
    );
  });
});

describe("segmentTimeDeltaSeconds", () => {
  it("is negative when points go backwards, so the caller's > 0 guard applies", () => {
    expect(segmentTimeDeltaSeconds(1_756_339_205_000, 1_756_339_200_000)).toBe(
      -5,
    );
  });
});

describe("computeSpeedThresholds", () => {
  const segmentsFromSpeeds = (speedsMps: number[]) =>
    speedsMps.map((speedMps, index) => ({
      id: `${index}-${index + 1}`,
      pointId: index + 1,
      timestamp: index,
      previousLatitude: 0,
      previousLongitude: 0,
      latitude: 0,
      longitude: 0,
      timeDeltaSeconds: 1,
      distanceMeters: speedMps,
      speedMps,
      speedMph: speedMps * 2.2369362921,
    }));

  it("falls back to the clamped floor with no segments at all", () => {
    expect(computeSpeedThresholds([])).toEqual({
      outlierThresholdMph: 25,
      chartSpeedCapMph: 0,
    });
  });

  it("clamps the outlier threshold into the 25..120 mph band", () => {
    // Everything slow: 95th percentile * 1.6 is well under the 25 mph floor.
    expect(
      computeSpeedThresholds(segmentsFromSpeeds(new Array(200).fill(1)))
        .outlierThresholdMph,
    ).toBe(25);

    // Everything absurdly fast: capped at 120 mph.
    expect(
      computeSpeedThresholds(segmentsFromSpeeds(new Array(200).fill(500)))
        .outlierThresholdMph,
    ).toBe(120);
  });

  it("ignores negative speeds, matching WHERE speed_mps >= 0", () => {
    const withNegatives = computeSpeedThresholds(
      segmentsFromSpeeds([-100, -50, ...new Array(198).fill(10)]),
    );
    const withoutNegatives = computeSpeedThresholds(
      segmentsFromSpeeds(new Array(198).fill(10)),
    );

    expect(withNegatives).toEqual(withoutNegatives);
  });

  it("caps the chart at the 99th NTILE bucket, excluding the top spikes", () => {
    // 200 segments: two rows per bucket, so bucket <= 99 covers the slowest 198.
    const speeds = [...new Array(198).fill(10), 900, 1000];
    const thresholds = computeSpeedThresholds(segmentsFromSpeeds(speeds));

    expect(thresholds.chartSpeedCapMph).toBeCloseTo(10 * 2.2369362921, 9);
  });
});
