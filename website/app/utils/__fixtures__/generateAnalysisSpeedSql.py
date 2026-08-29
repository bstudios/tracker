#!/usr/bin/env python3
"""Regenerate analysisSpeedSql.json from the *original* analysis SQL.

`app/utils/analysisSpeed.ts` replaced a SQL CTE chain (points -> points_with_previous ->
segments -> ranked_segments, with NTILE(100) driving two user-visible thresholds) with the
equivalent JavaScript. The SQL below is that chain, copied verbatim from the version of
`app/routes/date/analysis.tsx` that preceded the rewrite; running it against real SQLite
and asserting the JS matches is the only way to be confident the NTILE bucket boundaries
in particular were reproduced rather than approximated.

Python's stdlib sqlite3 is used because the repo has no SQLite binding in node_modules and
this change did not warrant adding one. Requires SQLite >= 3.35 built with
SQLITE_ENABLE_MATH_FUNCTIONS (for COS/SQRT) - checked at startup.

    python3 app/utils/__fixtures__/generateAnalysisSpeedSql.py
"""

import json
import math
import os
import random
import sqlite3

SEGMENTS_SQL = """
WITH points AS (
  SELECT id, timestamp, latitude, longitude FROM events ORDER BY timestamp
),
points_with_previous AS (
  SELECT
    id, timestamp, latitude, longitude,
    LAG(id) OVER (ORDER BY timestamp, id) AS previous_point_id,
    LAG(timestamp) OVER (ORDER BY timestamp, id) AS previous_timestamp,
    LAG(latitude) OVER (ORDER BY timestamp, id) AS previous_latitude,
    LAG(longitude) OVER (ORDER BY timestamp, id) AS previous_longitude
  FROM points
),
segments AS (
  SELECT
    previous_point_id || '-' || id AS id,
    id AS point_id,
    timestamp,
    previous_latitude,
    previous_longitude,
    latitude,
    longitude,
    {time_delta} AS time_delta_seconds,
    {distance} AS distance_meters,
    {speed_mps} AS speed_mps,
    ({speed_mps}) * 2.2369362921 AS speed_mph
  FROM points_with_previous
  WHERE previous_point_id IS NOT NULL
)
"""

DISTANCE = """
    CASE
      WHEN previous_latitude IS NULL OR previous_longitude IS NULL THEN 0
      ELSE SQRT(
        ((CAST(latitude AS REAL) - CAST(previous_latitude AS REAL)) * 111320.0) *
        ((CAST(latitude AS REAL) - CAST(previous_latitude AS REAL)) * 111320.0) +
        ((CAST(longitude AS REAL) - CAST(previous_longitude AS REAL)) *
          (111320.0 * COS(((CAST(latitude AS REAL) + CAST(previous_latitude AS REAL)) / 2.0) * 0.01745329252))) *
        ((CAST(longitude AS REAL) - CAST(previous_longitude AS REAL)) *
          (111320.0 * COS(((CAST(latitude AS REAL) + CAST(previous_latitude AS REAL)) / 2.0) * 0.01745329252)))
      )
    END
"""

TIME_DELTA = """
      CASE
        WHEN previous_timestamp IS NULL THEN 0
        WHEN ABS(timestamp) >= 1000000000000000 THEN (timestamp - previous_timestamp) / 1000000.0
        WHEN ABS(timestamp) >= 1000000000000 THEN (timestamp - previous_timestamp) / 1000.0
        ELSE (timestamp - previous_timestamp) * 1.0
      END
"""

SPEED_MPS = """
    CASE
      WHEN ({time_delta}) > 0 THEN COALESCE({distance}, 0) / ({time_delta})
      ELSE 0
    END
""".format(time_delta=TIME_DELTA, distance=DISTANCE)

CTE = SEGMENTS_SQL.format(
    time_delta=TIME_DELTA, distance=DISTANCE, speed_mps=SPEED_MPS
)

SUMMARY_SQL = (
    CTE
    + """,
ranked_segments AS (
  SELECT
    speed_mph,
    speed_mps,
    NTILE(100) OVER (ORDER BY speed_mps) AS speed_percentile_bucket
  FROM segments
  WHERE speed_mps >= 0
)
SELECT
  (SELECT COUNT(*) FROM points) AS points,
  MIN(
    120.0,
    MAX(
      25.0,
      COALESCE(
        (SELECT MAX(speed_mph) FROM ranked_segments WHERE speed_percentile_bucket <= 95),
        (SELECT MAX(speed_mph) FROM ranked_segments),
        0
      ) * 1.6
    )
  ) AS outlier_threshold_mph,
  COALESCE(
    (SELECT MAX(speed_mph) FROM ranked_segments WHERE speed_percentile_bucket <= 99),
    (SELECT MAX(speed_mph) FROM ranked_segments),
    0
  ) AS chart_speed_cap_mph
FROM points
LIMIT 1
"""
)

SEGMENT_ROWS_SQL = (
    CTE
    + """
SELECT id, point_id, timestamp, previous_latitude, previous_longitude, latitude,
       longitude, time_delta_seconds, distance_meters, speed_mps, speed_mph
FROM segments
ORDER BY timestamp
"""
)


def run(points):
    connection = sqlite3.connect(":memory:")
    connection.execute(
        "CREATE TABLE events (id INTEGER PRIMARY KEY, timestamp INTEGER NOT NULL,"
        " latitude REAL NOT NULL, longitude REAL NOT NULL)"
    )
    connection.executemany(
        "INSERT INTO events (id, timestamp, latitude, longitude) VALUES (?, ?, ?, ?)",
        [(p["id"], p["timestamp"], p["latitude"], p["longitude"]) for p in points],
    )

    # The four coordinate columns are recorded only as a checksum of the pairing (they are
    # verbatim copies of the input points), so they are asserted via the `id` and the
    # derived figures rather than stored again for every segment.
    segments = [
        {
            "id": row[0],
            "pointId": row[1],
            "timestamp": row[2],
            "timeDeltaSeconds": row[7],
            "distanceMeters": row[8],
            "speedMps": row[9],
            "speedMph": row[10],
        }
        for row in connection.execute(SEGMENT_ROWS_SQL)
    ]

    summary_row = connection.execute(SUMMARY_SQL).fetchone()
    summary = (
        None
        if summary_row is None
        else {
            "points": summary_row[0],
            "outlierThresholdMph": summary_row[1],
            "chartSpeedCapMph": summary_row[2],
        }
    )
    connection.close()
    return {"segments": segments, "summary": summary}


def walk(count, *, start_id=1, start_timestamp=1_756_339_200_000, seed=1):
    """A plausible day of fixes: ~5s apart, drifting around a start position."""
    rng = random.Random(seed)
    latitude, longitude = 51.5074, -0.1278
    points = []
    timestamp = start_timestamp
    for index in range(count):
        # A little jitter plus steady travel, with the occasional GPS spike so the
        # percentile thresholds have real outliers to clamp.
        step = 0.0009 if rng.random() > 0.02 else 0.02
        latitude += step * rng.uniform(0.2, 1.0)
        longitude += step * rng.uniform(-1.0, 1.0)
        points.append(
            {
                "id": start_id + index,
                "timestamp": timestamp,
                "latitude": round(latitude, 6),
                "longitude": round(longitude, 6),
            }
        )
        timestamp += 5000 * rng.randint(1, 3)
    return points


def main():
    cases = {}

    # Row counts chosen to straddle NTILE(100) group-size boundaries: fewer rows than
    # buckets, exactly one full bucket each, and remainders either side of 95 and 99.
    for count in [0, 1, 2, 3, 50, 95, 96, 99, 100, 101, 150, 197, 199, 200, 253, 301]:
        cases[f"walk{count}"] = walk(count, seed=count + 7)

    # Duplicate timestamps: zero time delta, and the LAG frame's `, id` tiebreak.
    cases["duplicateTimestamps"] = [
        {"id": 1, "timestamp": 1_756_339_200_000, "latitude": 51.5, "longitude": -0.12},
        {"id": 2, "timestamp": 1_756_339_200_000, "latitude": 51.5001, "longitude": -0.12},
        {"id": 3, "timestamp": 1_756_339_205_000, "latitude": 51.5002, "longitude": -0.121},
        {"id": 4, "timestamp": 1_756_339_205_000, "latitude": 51.5003, "longitude": -0.121},
    ]

    # Out-of-order insertion ids, to prove ordering comes from the timestamps.
    cases["unsortedIds"] = [
        {"id": 9, "timestamp": 1_756_339_210_000, "latitude": 51.5002, "longitude": -0.1202},
        {"id": 3, "timestamp": 1_756_339_200_000, "latitude": 51.5000, "longitude": -0.1200},
        {"id": 7, "timestamp": 1_756_339_205_000, "latitude": 51.5001, "longitude": -0.1201},
    ]

    # Fixes either side of midnight UTC (this route buckets by UTC day, but a day's
    # points can still span the boundary of anything else).
    cases["dayBoundary"] = [
        {"id": 1, "timestamp": 1_756_339_198_000, "latitude": 51.5, "longitude": -0.12},
        {"id": 2, "timestamp": 1_756_339_200_000, "latitude": 51.5004, "longitude": -0.1204},
        {"id": 3, "timestamp": 1_756_339_202_000, "latitude": 51.5008, "longitude": -0.1208},
    ]

    # All fixes in legacy *seconds*.
    cases["secondsTimestamps"] = [
        {"id": 1, "timestamp": 1_756_339_200, "latitude": 51.5, "longitude": -0.12},
        {"id": 2, "timestamp": 1_756_339_205, "latitude": 51.5004, "longitude": -0.1204},
        {"id": 3, "timestamp": 1_756_339_212, "latitude": 51.5009, "longitude": -0.1209},
    ]

    # All fixes in microseconds.
    cases["microsecondTimestamps"] = [
        {"id": 1, "timestamp": 1_756_339_200_000_000, "latitude": 51.5, "longitude": -0.12},
        {"id": 2, "timestamp": 1_756_339_205_000_000, "latitude": 51.5004, "longitude": -0.1204},
        {"id": 3, "timestamp": 1_756_339_212_000_000, "latitude": 51.5009, "longitude": -0.1209},
    ]

    # A seconds row followed by a millis row. The one case where the JS deliberately
    # differs from this SQL - see segmentTimeDeltaSeconds - so the test suite asserts the
    # corrected value against these rows rather than the SQL's.
    cases["mixedMagnitudeTimestamps"] = [
        {"id": 1, "timestamp": 1_756_339_200, "latitude": 51.5, "longitude": -0.12},
        {"id": 2, "timestamp": 1_756_339_205_000, "latitude": 51.5004, "longitude": -0.1204},
        {"id": 3, "timestamp": 1_756_339_212_000, "latitude": 51.5009, "longitude": -0.1209},
    ]

    # Every segment a genuine stop (no movement at all) - exercises the zero-speed
    # percentile fallbacks.
    cases["stationary"] = [
        {"id": index + 1, "timestamp": 1_756_339_200_000 + index * 5000,
         "latitude": 51.5, "longitude": -0.12}
        for index in range(120)
    ]

    fixture = {
        "_generatedBy": os.path.basename(__file__),
        "sqliteVersion": sqlite3.sqlite_version,
        "cases": {
            name: {"points": points, "expected": run(points)}
            for name, points in cases.items()
        },
    }

    path = os.path.join(os.path.dirname(__file__), "analysisSpeedSql.json")
    with open(path, "w", encoding="utf-8") as handle:
        # One case per line: readable enough to diff, without a megabyte of indentation.
        handle.write('{\n')
        handle.write(f'  "_generatedBy": {json.dumps(fixture["_generatedBy"])},\n')
        handle.write(f'  "sqliteVersion": {json.dumps(fixture["sqliteVersion"])},\n')
        handle.write('  "cases": {\n')
        entries = list(fixture["cases"].items())
        for index, (name, case) in enumerate(entries):
            comma = "" if index == len(entries) - 1 else ","
            handle.write(f"    {json.dumps(name)}: {json.dumps(case)}{comma}\n")
        handle.write("  }\n}\n")
    print(f"wrote {path} ({len(cases)} cases, sqlite {sqlite3.sqlite_version})")


if __name__ == "__main__":
    try:
        sqlite3.connect(":memory:").execute("SELECT COS(0.5), SQRT(4.0)").fetchone()
    except sqlite3.OperationalError as error:  # pragma: no cover - environment guard
        raise SystemExit(
            f"This SQLite build lacks math functions ({error}); "
            "rebuild with SQLITE_ENABLE_MATH_FUNCTIONS."
        )
    assert math.isclose(math.cos(0.5), 0.8775825618903728)
    main()
