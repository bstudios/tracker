import { getDb, getPasswordRouteAccess } from "~/routeContext";
import {
  Button,
  Card,
  Center,
  Container,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { LineChart } from "@mantine/charts";
import { and, asc, gte, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { useState } from "react";
import { Link, type MetaFunction } from "react-router";
import { AnalysisMap } from "~/components/AnalysisMap/AnalysisMap";
import {
  buildLegendTicks,
  getSpeedRange,
} from "~/components/AnalysisMap/speedColor";
import * as Schema from "~/database/schema.d";
import type { Route } from "./+types/analysis";

const MPS_TO_MPH = 2.2369362921;

const chooseTickIntervalMinutes = (startMillis: number, endMillis: number) => {
  const durationMinutes = Math.max(1, (endMillis - startMillis) / 60000);

  if (durationMinutes <= 360) return 15;
  if (durationMinutes <= 720) return 30;
  return 60;
};

const buildRoundedTickTimestamps = (startMillis: number, endMillis: number) => {
  const intervalMinutes = chooseTickIntervalMinutes(startMillis, endMillis);
  let cursor = DateTime.fromMillis(startMillis, {
    zone: "Europe/London",
  }).startOf("hour");

  const minuteRemainder = cursor.minute % intervalMinutes;
  if (minuteRemainder !== 0) {
    cursor = cursor.plus({ minutes: intervalMinutes - minuteRemainder });
  }

  if (cursor.toMillis() < startMillis) {
    cursor = cursor.plus({ minutes: intervalMinutes });
  }

  const ticks: number[] = [];
  while (cursor.toMillis() <= endMillis) {
    ticks.push(cursor.toMillis());
    cursor = cursor.plus({ minutes: intervalMinutes });
  }

  return ticks;
};

export const meta: MetaFunction = () => {
  return [{ title: "Analysis" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const { refDate, urlDate, password } = getPasswordRouteAccess(context);

  const db = getDb(context);
  const dayStart = refDate.startOf("day").toMillis();
  const dayEnd = refDate.endOf("day").toMillis();

  const points = db.$with("points").as(
    db
      .select({
        id: Schema.Events.id,
        timestamp: Schema.Events.timestamp,
        latitude:
          sql<number>`CAST(json_extract(${Schema.Events.data}, '$.location.latitude') AS REAL)`.as(
            "latitude",
          ),
        longitude:
          sql<number>`CAST(json_extract(${Schema.Events.data}, '$.location.longitude') AS REAL)`.as(
            "longitude",
          ),
      })
      .from(Schema.Events)
      .where(
        and(
          gte(Schema.Events.timestamp, dayStart),
          lte(Schema.Events.timestamp, dayEnd),
          sql`json_extract(${Schema.Events.data}, '$.location.latitude') IS NOT NULL`,
          sql`json_extract(${Schema.Events.data}, '$.location.longitude') IS NOT NULL`,
        ),
      )
      .orderBy(asc(Schema.Events.timestamp)),
  );

  const pointsWithPrevious = db.$with("points_with_previous").as(
    db
      .select({
        id: points.id,
        timestamp: points.timestamp,
        latitude: points.latitude,
        longitude: points.longitude,
        previousPointId: sql<
          number | null
        >`LAG(${points.id}) OVER (ORDER BY ${points.timestamp}, ${points.id})`.as(
          "previous_point_id",
        ),
        previousTimestamp: sql<
          number | null
        >`LAG(${points.timestamp}) OVER (ORDER BY ${points.timestamp}, ${points.id})`.as(
          "previous_timestamp",
        ),
        previousLatitude: sql<
          number | null
        >`LAG(${points.latitude}) OVER (ORDER BY ${points.timestamp}, ${points.id})`.as(
          "previous_latitude",
        ),
        previousLongitude: sql<
          number | null
        >`LAG(${points.longitude}) OVER (ORDER BY ${points.timestamp}, ${points.id})`.as(
          "previous_longitude",
        ),
      })
      .from(points),
  );

  const distanceMetersExpression = sql<number>`
    CASE
      WHEN ${pointsWithPrevious.previousLatitude} IS NULL OR ${pointsWithPrevious.previousLongitude} IS NULL THEN 0
      ELSE SQRT(
        ((CAST(${pointsWithPrevious.latitude} AS REAL) - CAST(${pointsWithPrevious.previousLatitude} AS REAL)) * 111320.0) *
        ((CAST(${pointsWithPrevious.latitude} AS REAL) - CAST(${pointsWithPrevious.previousLatitude} AS REAL)) * 111320.0) +
        ((CAST(${pointsWithPrevious.longitude} AS REAL) - CAST(${pointsWithPrevious.previousLongitude} AS REAL)) *
          (111320.0 * COS(((CAST(${pointsWithPrevious.latitude} AS REAL) + CAST(${pointsWithPrevious.previousLatitude} AS REAL)) / 2.0) * 0.01745329252))) *
        ((CAST(${pointsWithPrevious.longitude} AS REAL) - CAST(${pointsWithPrevious.previousLongitude} AS REAL)) *
          (111320.0 * COS(((CAST(${pointsWithPrevious.latitude} AS REAL) + CAST(${pointsWithPrevious.previousLatitude} AS REAL)) / 2.0) * 0.01745329252)))
      )
    END
  `;

  const timeDeltaSecondsExpression = sql<number>`
      CASE
        WHEN ${pointsWithPrevious.previousTimestamp} IS NULL THEN 0
        WHEN ABS(${pointsWithPrevious.timestamp}) >= 1000000000000000 THEN (${pointsWithPrevious.timestamp} - ${pointsWithPrevious.previousTimestamp}) / 1000000.0
        WHEN ABS(${pointsWithPrevious.timestamp}) >= 1000000000000 THEN (${pointsWithPrevious.timestamp} - ${pointsWithPrevious.previousTimestamp}) / 1000.0
        ELSE (${pointsWithPrevious.timestamp} - ${pointsWithPrevious.previousTimestamp}) * 1.0
      END
    `;

  const speedMpsExpression = sql<number>`
    CASE
      WHEN ${timeDeltaSecondsExpression} > 0 THEN COALESCE(${distanceMetersExpression}, 0) / ${timeDeltaSecondsExpression}
      ELSE 0
    END
  `;

  const segments = db.$with("segments").as(
    db
      .select({
        id: sql<string>`${pointsWithPrevious.previousPointId} || '-' || ${pointsWithPrevious.id}`.as(
          "id",
        ),
        pointId: pointsWithPrevious.id,
        timestamp: pointsWithPrevious.timestamp,
        previousLatitude: pointsWithPrevious.previousLatitude,
        previousLongitude: pointsWithPrevious.previousLongitude,
        latitude: pointsWithPrevious.latitude,
        longitude: pointsWithPrevious.longitude,
        timeDeltaSeconds: timeDeltaSecondsExpression.as("time_delta_seconds"),
        distanceMeters: distanceMetersExpression.as("distance_meters"),
        speedMps: speedMpsExpression.as("speed_mps"),
        speedMph: sql<number>`${speedMpsExpression} * ${MPS_TO_MPH}`.as(
          "speed_mph",
        ),
        isStop:
          sql<number>`CASE WHEN ${speedMpsExpression} < 0.5 THEN 1 ELSE 0 END`.as(
            "is_stop",
          ),
      })
      .from(pointsWithPrevious)
      .where(sql`${pointsWithPrevious.previousPointId} IS NOT NULL`),
  );

  const rankedSegments = db.$with("ranked_segments").as(
    db
      .select({
        speedMph: segments.speedMph,
        speedMps: segments.speedMps,
        distanceMeters: segments.distanceMeters,
        timeDeltaSeconds: segments.timeDeltaSeconds,
        isStop: segments.isStop,
        speedPercentileBucket:
          sql<number>`NTILE(100) OVER (ORDER BY ${segments.speedMps})`.as(
            "speed_percentile_bucket",
          ),
      })
      .from(segments)
      .where(sql`${segments.speedMps} >= 0`),
  );

  const [pointRows, segmentRows, summaryRow] = await Promise.all([
    db
      .with(points)
      .select({
        id: points.id,
        timestamp: points.timestamp,
        latitude: points.latitude,
        longitude: points.longitude,
      })
      .from(points)
      .orderBy(asc(points.timestamp)),
    db
      .with(points, pointsWithPrevious, segments)
      .select({
        id: segments.id,
        pointId: segments.pointId,
        timestamp: segments.timestamp,
        timeDeltaSeconds: segments.timeDeltaSeconds,
        distanceMeters: segments.distanceMeters,
        speedMps: segments.speedMps,
        speedMph: segments.speedMph,
        isStop: segments.isStop,
        previousLatitude: segments.previousLatitude,
        previousLongitude: segments.previousLongitude,
        latitude: segments.latitude,
        longitude: segments.longitude,
      })
      .from(segments)
      .orderBy(asc(segments.timestamp)),
    db
      .with(points, pointsWithPrevious, segments, rankedSegments)
      .select({
        points: sql<number>`(SELECT COUNT(*) FROM points)`.as("points"),
        segments: sql<number>`(SELECT COUNT(*) FROM segments)`.as("segments"),
        outlierThresholdMph: sql<number>`
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
          )
        `.as("outlier_threshold_mph"),
        chartSpeedCapMph: sql<number>`
          COALESCE(
            (SELECT MAX(speed_mph) FROM ranked_segments WHERE speed_percentile_bucket <= 99),
            (SELECT MAX(speed_mph) FROM ranked_segments),
            0
          )
        `.as("chart_speed_cap_mph"),
        stopCount:
          sql<number>`(SELECT COALESCE(SUM(is_stop), 0) FROM segments)`.as(
            "stop_count",
          ),
        slowestSegmentSpeedMph: sql<
          number | null
        >`(SELECT MIN(speed_mph) FROM segments)`.as(
          "slowest_segment_speed_mph",
        ),
      })
      .from(points)
      .limit(1),
  ]);

  const pointsWithDerivedSpeed = pointRows.map((point) => ({
    id: Number(point.id),
    timestamp: Number(point.timestamp),
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
    speedMps: 0,
  }));

  const outlierThresholdMph = Number(summaryRow[0]?.outlierThresholdMph ?? 120);

  const pointIndexById = new Map<number, number>();
  pointsWithDerivedSpeed.forEach((point, index) => {
    pointIndexById.set(point.id, index);
  });

  const routeSegments = segmentRows
    .map((segment) => {
      const pointIdFromField = Number(segment.pointId);
      const pointIdFromSegmentId =
        typeof segment.id === "string"
          ? Number(segment.id.split("-")[1])
          : Number.NaN;
      const pointId = Number.isFinite(pointIdFromField)
        ? pointIdFromField
        : pointIdFromSegmentId;
      const timestamp = Number(segment.timestamp);
      const timeDeltaSeconds = Number(segment.timeDeltaSeconds);
      const distanceMeters = Number(segment.distanceMeters);
      const speedMps = Number(segment.speedMps);
      const speedMph = Number(segment.speedMph);
      const latitude = Number(segment.latitude);
      const longitude = Number(segment.longitude);
      const previousLatitude =
        segment.previousLatitude != null
          ? Number(segment.previousLatitude)
          : latitude;
      const previousLongitude =
        segment.previousLongitude != null
          ? Number(segment.previousLongitude)
          : longitude;

      return {
        id: segment.id,
        pointId,
        timestamp,
        timeDeltaSeconds,
        distanceMeters,
        speedMps,
        speedMph,
        isStop: Boolean(segment.isStop),
        positions: [
          [previousLatitude, previousLongitude],
          [latitude, longitude],
        ] as [number, number][],
      };
    })
    .filter(
      (segment) =>
        Number.isFinite(segment.pointId) &&
        Number.isFinite(segment.speedMph) &&
        segment.speedMph >= 0 &&
        segment.speedMph <= outlierThresholdMph,
    );

  routeSegments.forEach((segment) => {
    const pointIndex = pointIndexById.get(segment.pointId);
    if (typeof pointIndex === "number") {
      pointsWithDerivedSpeed[pointIndex].speedMps = segment.speedMps;
    }
  });

  const totalFilteredTimeDeltaSeconds = routeSegments.reduce(
    (total, segment) =>
      segment.timeDeltaSeconds > 0 ? total + segment.timeDeltaSeconds : total,
    0,
  );
  const totalFilteredDistanceMeters = routeSegments.reduce(
    (total, segment) => total + segment.distanceMeters,
    0,
  );

  const filteredAverageSpeedMph =
    totalFilteredTimeDeltaSeconds > 0
      ? (totalFilteredDistanceMeters / totalFilteredTimeDeltaSeconds) *
        MPS_TO_MPH
      : 0;
  const filteredMaxSpeedMph = routeSegments.reduce(
    (max, segment) => Math.max(max, segment.speedMph),
    0,
  );
  const filteredSlowestSegmentSpeedMph =
    routeSegments.length > 0
      ? routeSegments.reduce(
          (min, segment) => Math.min(min, segment.speedMph),
          Number.POSITIVE_INFINITY,
        )
      : null;
  const filteredStopCount = routeSegments.reduce(
    (count, segment) => (segment.isStop ? count + 1 : count),
    0,
  );

  const chartData = pointsWithDerivedSpeed.map((point) => ({
    pointId: point.id,
    timestampMillis: point.timestamp,
    speedMph: Number((point.speedMps * MPS_TO_MPH).toFixed(2)),
  }));

  const roundedTickTimestamps =
    chartData.length > 1
      ? buildRoundedTickTimestamps(
          chartData[0].timestampMillis,
          chartData[chartData.length - 1].timestampMillis,
        )
      : [];

  return {
    date: refDate.toISO(),
    urlDate,
    password,
    chartData,
    roundedTickTimestamps,
    summary: {
      points: summaryRow[0]?.points ?? 0,
      segments: routeSegments.length,
      averageSpeedMph: Number(filteredAverageSpeedMph.toFixed(1)),
      maxSpeedMph: Number(filteredMaxSpeedMph.toFixed(1)),
      chartSpeedCapMph: Number(
        Math.min(
          Number(summaryRow[0]?.chartSpeedCapMph ?? filteredMaxSpeedMph),
          outlierThresholdMph,
        ).toFixed(1),
      ),
      stopCount: filteredStopCount,
      slowestSegmentSpeedMph:
        filteredSlowestSegmentSpeedMph != null &&
        Number.isFinite(filteredSlowestSegmentSpeedMph)
          ? Number(filteredSlowestSegmentSpeedMph.toFixed(1))
          : null,
    },
    route: {
      points: pointsWithDerivedSpeed,
      segments: routeSegments,
    },
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const [hoveredPointId, setHoveredPointId] = useState<number | null>(null);
  const backToMapHref = `/${loaderData.password}/${loaderData.urlDate}`;
  const segmentSpeeds = loaderData.route.segments.map(
    (segment) => segment.speedMph,
  );
  const hasSegmentSpeeds = segmentSpeeds.length > 0;
  const speedRange = getSpeedRange(segmentSpeeds);
  const legendTicks = hasSegmentSpeeds ? buildLegendTicks(speedRange, 5) : [];
  const chartYAxisMax = Math.max(
    5,
    loaderData.summary.chartSpeedCapMph,
    loaderData.summary.maxSpeedMph * 1.05,
    loaderData.summary.averageSpeedMph,
  );

  const lineChartInteractionProps: {
    onMouseMove: (event: unknown) => void;
    onMouseLeave: () => void;
  } = {
    onMouseMove: (event) => {
      const rawPointId =
        typeof event === "object" &&
        event !== null &&
        "activePayload" in event &&
        Array.isArray((event as { activePayload?: unknown }).activePayload)
          ? ((
              event as {
                activePayload: Array<{ payload?: { pointId?: number } }>;
              }
            ).activePayload[0]?.payload?.pointId ?? null)
          : null;

      const pointId =
        rawPointId == null
          ? null
          : Number.isFinite(Number(rawPointId))
            ? Number(rawPointId)
            : null;

      setHoveredPointId(pointId);
    },
    onMouseLeave: () => {
      setHoveredPointId(null);
    },
  };

  return (
    <Container fluid p="md">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Group>
            <Button component={Link} to={backToMapHref} variant="light">
              Back to live map
            </Button>
            <Title order={1}>Analysis</Title>
          </Group>
          <Text c="dimmed">{loaderData.urlDate}</Text>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Position points
            </Text>
            <Title order={3}>{loaderData.summary.points}</Title>
          </Card>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Average speed
            </Text>
            <Title order={3}>{loaderData.summary.averageSpeedMph} mph</Title>
          </Card>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Maximum speed
            </Text>
            <Title order={3}>{loaderData.summary.maxSpeedMph} mph</Title>
          </Card>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Stops
            </Text>
            <Title order={3}>{loaderData.summary.stopCount}</Title>
          </Card>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Segments
            </Text>
            <Title order={3}>{loaderData.summary.segments}</Title>
            <Text c="dimmed" size="xs">
              Slowest segment:{" "}
              {loaderData.summary.slowestSegmentSpeedMph ?? "n/a"} mph
            </Text>
          </Card>
        </SimpleGrid>

        <Card withBorder>
          <Group justify="space-between" align="center" mb="md">
            <div>
              <Title order={2}>Speed over time</Title>
              <Text c="dimmed" size="sm">
                Derived from the tracked position samples for the day.
              </Text>
            </div>
          </Group>
          {loaderData.chartData.length === 0 ? (
            <Center py="xl">
              <Stack align="center">
                <Title order={3}>No location data to analyse yet</Title>
                <Button component={Link} to={backToMapHref} variant="light">
                  Return to map
                </Button>
              </Stack>
            </Center>
          ) : (
            <LineChart
              h={320}
              data={loaderData.chartData}
              dataKey="timestampMillis"
              series={[
                { name: "speedMph", color: "pink.6", label: "Speed (mph)" },
              ]}
              curveType="linear"
              withDots={false}
              withLegend
              tickLine="y"
              withXAxis
              withYAxis
              gridAxis="y"
              yAxisProps={{
                domain: [0, chartYAxisMax],
                allowDataOverflow: true,
              }}
              xAxisProps={{
                type: "number",
                scale: "time",
                domain: ["dataMin", "dataMax"],
                ticks: loaderData.roundedTickTimestamps,
                tickFormatter: (value: number) =>
                  DateTime.fromMillis(value, {
                    zone: "Europe/London",
                  }).toFormat("HH:mm"),
              }}
              tooltipProps={{
                labelFormatter: (value: number) =>
                  DateTime.fromMillis(value, {
                    zone: "Europe/London",
                  }).toFormat("HH:mm:ss"),
              }}
              lineChartProps={lineChartInteractionProps}
            />
          )}
        </Card>

        <Card withBorder>
          <Group justify="space-between" align="center" mb="md">
            <div>
              <Title order={2}>Route by speed</Title>
              <Text c="dimmed" size="sm">
                The path is split into segments and colored by pace. Slower
                sections are easier to spot than on the live map.
              </Text>
            </div>
          </Group>
          {loaderData.route.points.length === 0 ? (
            <Center py="xl">
              <Stack align="center">
                <Title order={3}>No route map available</Title>
              </Stack>
            </Center>
          ) : (
            <AnalysisMap
              points={loaderData.route.points}
              segments={loaderData.route.segments}
              highlightedPointId={hoveredPointId}
            />
          )}
        </Card>

        <Card withBorder>
          <Title order={2} mb="xs">
            Legend
          </Title>
          <Stack gap="xs">
            <Text c="dimmed" size="sm">
              Route segments are colored by speed for this day&apos;s range.
            </Text>
            {hasSegmentSpeeds ? (
              <>
                <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
                  {legendTicks.map((tick) => (
                    <Group key={tick.speedMph} gap="xs" wrap="nowrap">
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 999,
                          backgroundColor: tick.color,
                          flexShrink: 0,
                        }}
                      />
                      <Text size="sm">{tick.speedMph.toFixed(1)} mph</Text>
                    </Group>
                  ))}
                </SimpleGrid>
                <Text c="dimmed" size="xs">
                  Min {speedRange.minMph.toFixed(1)} mph, max{" "}
                  {speedRange.maxMph.toFixed(1)} mph.
                </Text>
              </>
            ) : (
              <Text c="dimmed" size="sm">
                No route segments available for speed-based coloring yet.
              </Text>
            )}
            <Text c="dimmed" size="sm">
              Hover over the speed chart to place the red X marker on the
              corresponding map position.
            </Text>
          </Stack>
        </Card>
      </Stack>
    </Container>
  );
}
