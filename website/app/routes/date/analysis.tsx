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
import { AreaChart } from "@mantine/charts";
import { and, asc, eq } from "drizzle-orm";
import { memo, useEffect, useState } from "react";
import { Link, type MetaFunction } from "react-router";
import { AnalysisMap } from "~/components/AnalysisMap/AnalysisMap";
import {
  buildLegendTicks,
  getSpeedRange,
} from "~/components/AnalysisMap/speedColor";
import * as Schema from "~/database/schema.d";
import {
  buildSpeedSegments,
  computeSpeedThresholds,
} from "~/utils/analysisSpeed";
import {
  displayDateTime,
  formatDateTimeWithSeconds,
  toMillisTimestamp,
} from "~/utils/dateTime";
import {
  fromMetersPerSecond,
  isSpeedUnit,
  SPEED_UNIT_LABELS,
  toMetersPerSecond,
  type SpeedUnit,
} from "~/utils/speedUnits";
import type { Route } from "./+types/analysis";

const DEFAULT_DISPLAY_SPEED_UNIT: SpeedUnit = "mph";

// Below this a point is considered stationary regardless of which speed source produced it.
const STOP_SPEED_THRESHOLD_MPS = 0.5;

const getYAxisStep = (maxSpeedDisplay: number) => {
  if (maxSpeedDisplay <= 10) return 1;
  if (maxSpeedDisplay <= 50) return 5;
  return 10;
};

const SpeedChart = memo(function SpeedChart(props: {
  data: Array<{
    pointId: number;
    timestampMillis: number;
    timestampLabel: string;
    speedDisplay: number;
  }>;
  speedUnitLabel: string;
  normalizedChartYAxisMax: number;
  yAxisTicks: number[];
  onHoveredPointIdChange: (pointId: number | null) => void;
}) {
  const TooltipContent = (tooltipProps: any) => {
    const active = Boolean(tooltipProps?.active);
    const payload = tooltipProps?.payload as
      | ReadonlyArray<{
          payload?: { pointId?: number; timestampMillis?: number };
          name?: string | number;
          value?: string | number;
          color?: string;
        }>
      | undefined;
    const entries = payload ?? [];
    const speedEntry = entries.find((entry) => entry.name === "speedDisplay");
    const rawPointId = entries.find((entry) =>
      Number.isFinite(Number(entry?.payload?.pointId)),
    )?.payload?.pointId;
    const pointId =
      rawPointId == null
        ? null
        : Number.isFinite(Number(rawPointId))
          ? Number(rawPointId)
          : null;

    useEffect(() => {
      if (!active || entries.length === 0) {
        props.onHoveredPointIdChange(null);
        return;
      }

      props.onHoveredPointIdChange(pointId);
    }, [active, entries.length, pointId]);

    if (!active || entries.length === 0) {
      return null;
    }

    const rawTimestamp = Number(
      entries[0]?.payload?.timestampMillis ?? Number.NaN,
    );
    const speedValue = Number(speedEntry?.value ?? 0);

    return (
      <div
        style={{
          background: "white",
          border: "1px solid #dee2e6",
          borderRadius: 8,
          padding: "8px 10px",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
        }}
      >
        <Text size="xs" c="dimmed">
          {Number.isFinite(rawTimestamp)
            ? formatDateTimeWithSeconds(rawTimestamp)
            : "-"}
        </Text>
        <Text size="sm" fw={600} c={speedEntry?.color}>
          Speed: {speedValue.toFixed(1)} {props.speedUnitLabel}
        </Text>
      </div>
    );
  };

  return (
    <AreaChart
      h={320}
      data={props.data}
      dataKey="timestampLabel"
      type="default"
      withGradient={false}
      fillOpacity={0.35}
      series={[
        {
          name: "speedDisplay",
          color: "red.7",
          label: `Speed (${props.speedUnitLabel})`,
        },
      ]}
      curveType="linear"
      withDots={false}
      withLegend={false}
      valueFormatter={(value: number) =>
        `${value.toFixed(1)} ${props.speedUnitLabel}`
      }
      tickLine="y"
      withXAxis
      withYAxis
      gridAxis="y"
      yAxisProps={{
        domain: [0, props.normalizedChartYAxisMax],
        allowDataOverflow: true,
        ticks: props.yAxisTicks,
      }}
      xAxisProps={{
        interval: "preserveStartEnd",
        minTickGap: 36,
      }}
      tooltipProps={{
        content: TooltipContent,
      }}
      areaChartProps={{
        onMouseLeave: () => {
          props.onHoveredPointIdChange(null);
        },
      }}
      areaProps={{
        fill: "var(--mantine-color-red-7)",
        stroke: "var(--mantine-color-red-7)",
        fillOpacity: 0.35,
      }}
    />
  );
});

export const meta: MetaFunction = () => {
  return [{ title: "Analysis" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const { refDate, urlDate, password, deviceId } =
    getPasswordRouteAccess(context);

  const db = getDb(context);

  // The day's points are read once and every derived figure is computed from them in JS.
  // This used to be a `points` → `points_with_previous` (a `LAG(...)` window) → `segments`
  // → `ranked_segments` (`NTILE(100)`) CTE chain that ran three times per request — a raw
  // points query, a segments query and a summary query whose two correlated subqueries
  // re-derived the whole chain again. On a ~10k-point day that read ~300k rows out of D1
  // per page view, all of it re-deriving the same per-point arithmetic, and that SQLite
  // work competes with the concurrent GPS upload writes on the same database.
  const [pointRows, deviceRows] = await db.batch([
    db
      .select({
        id: Schema.Events.id,
        timestamp: Schema.Events.timestamp,
        latitude: Schema.Events.latitude,
        longitude: Schema.Events.longitude,
        data: Schema.Events.data,
      })
      .from(Schema.Events)
      .where(
        and(
          eq(Schema.Events.deviceId, deviceId),
          eq(Schema.Events.dateString, urlDate),
        ),
      )
      .orderBy(asc(Schema.Events.timestamp), asc(Schema.Events.id)),
    db
      .select({
        inputSpeedUnit: Schema.Devices.inputSpeedUnit,
        displaySpeedUnit: Schema.Devices.displaySpeedUnit,
      })
      .from(Schema.Devices)
      .where(eq(Schema.Devices.id, deviceId))
      .limit(1),
  ]);

  // Position-derived speed, purely from consecutive GPS fixes. Used as a fallback wherever
  // the device itself doesn't report a usable speed, and to figure out which of *those*
  // fallback segments are GPS-jitter outliers (see outlierThresholdMph below). Deliberately
  // still expressed in mph here rather than the device's display unit — it's an internal
  // filtering signal, never shown to the user.
  const segmentRows = buildSpeedSegments(
    pointRows.map((point) => ({
      id: Number(point.id),
      timestamp: Number(point.timestamp),
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
    })),
  );

  const speedThresholds = computeSpeedThresholds(segmentRows);

  const inputSpeedUnit: SpeedUnit | null = isSpeedUnit(
    deviceRows[0]?.inputSpeedUnit,
  )
    ? deviceRows[0].inputSpeedUnit
    : null;
  const displaySpeedUnit: SpeedUnit = isSpeedUnit(
    deviceRows[0]?.displaySpeedUnit,
  )
    ? deviceRows[0].displaySpeedUnit
    : DEFAULT_DISPLAY_SPEED_UNIT;
  const speedUnitLabel = SPEED_UNIT_LABELS[displaySpeedUnit];

  // A device's own reported speed usually comes straight off the GPS chip's Doppler
  // velocity, not by differencing noisy position fixes, so it's far less jumpy than the
  // derived calculation above. Prefer it per-point wherever the device actually reported
  // one (a reported value of exactly 0 is indistinguishable from "field absent, ingestion
  // defaulted it to 0", so those points still fall back to the derived speed).
  const deviceSpeedMpsByPointId = new Map<number, number>();
  if (inputSpeedUnit) {
    for (const point of pointRows) {
      const rawSpeed = point.data?.location?.speed;
      if (
        typeof rawSpeed === "number" &&
        Number.isFinite(rawSpeed) &&
        rawSpeed > 0
      ) {
        deviceSpeedMpsByPointId.set(
          Number(point.id),
          toMetersPerSecond(rawSpeed, inputSpeedUnit),
        );
      }
    }
  }

  const pointsWithDerivedSpeed = pointRows.map((point) => ({
    id: Number(point.id),
    timestamp: Number(point.timestamp),
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
    speedMps: 0,
  }));

  const outlierThresholdMph = speedThresholds.outlierThresholdMph;

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
      const derivedSpeedMps = Number(segment.speedMps);
      const derivedSpeedMph = Number(segment.speedMph);
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

      const deviceSpeedMps = deviceSpeedMpsByPointId.get(pointId) ?? null;
      const hasDeviceSpeed = deviceSpeedMps != null;
      const speedMps = deviceSpeedMps ?? derivedSpeedMps;

      return {
        id: segment.id,
        pointId,
        timestamp,
        timeDeltaSeconds,
        distanceMeters,
        speedMps,
        speedDisplay: fromMetersPerSecond(speedMps, displaySpeedUnit),
        isStop: speedMps < STOP_SPEED_THRESHOLD_MPS,
        hasDeviceSpeed,
        derivedSpeedMph,
        positions: [
          [previousLatitude, previousLongitude],
          [latitude, longitude],
        ] as [number, number][],
      };
    })
    .filter((segment) => {
      if (
        !Number.isFinite(segment.pointId) ||
        !Number.isFinite(segment.speedDisplay) ||
        segment.speedMps < 0
      ) {
        return false;
      }

      // Once a device has a configured input unit, its own reported speed is authoritative:
      // readings it didn't report are skipped outright rather than patched with a noisy
      // position-derived guess. Devices with no input unit configured keep the original
      // fully-derived behaviour, GPS-jitter outliers and all.
      return inputSpeedUnit
        ? segment.hasDeviceSpeed
        : segment.derivedSpeedMph <= outlierThresholdMph;
    })
    .map(({ hasDeviceSpeed, derivedSpeedMph, ...segment }) => segment);

  // Points whose segment didn't survive the filter above (an unreported device reading, or
  // a GPS-jitter outlier) have no resolved speed at all, so the chart should skip them
  // rather than show a false dip to zero.
  const resolvedPointIds = new Set(
    routeSegments.map((segment) => segment.pointId),
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
  // Distance implied by whichever speed source was resolved for the segment, not the raw
  // GPS distance — keeps the average consistent with the (possibly device-sourced) speeds
  // being averaged, and matches the old distance/time formula exactly when everything is
  // derived (speedMps *is* distanceMeters / timeDeltaSeconds in that case).
  const totalResolvedDistanceMeters = routeSegments.reduce(
    (total, segment) => total + segment.speedMps * segment.timeDeltaSeconds,
    0,
  );

  const filteredAverageSpeedMps =
    totalFilteredTimeDeltaSeconds > 0
      ? totalResolvedDistanceMeters / totalFilteredTimeDeltaSeconds
      : 0;
  const filteredMaxSpeedMps = routeSegments.reduce(
    (max, segment) => Math.max(max, segment.speedMps),
    0,
  );
  const filteredSlowestSegmentSpeedMps =
    routeSegments.length > 0
      ? routeSegments.reduce(
          (min, segment) => Math.min(min, segment.speedMps),
          Number.POSITIVE_INFINITY,
        )
      : null;
  const filteredStopCount = routeSegments.reduce(
    (count, segment) => (segment.isStop ? count + 1 : count),
    0,
  );

  const chartSpeedCapMps = Math.min(
    toMetersPerSecond(speedThresholds.chartSpeedCapMph, "mph"),
    toMetersPerSecond(outlierThresholdMph, "mph"),
  );

  const chartData = pointsWithDerivedSpeed
    .filter((point, index) => index === 0 || resolvedPointIds.has(point.id))
    .map((point) => ({
      pointId: point.id,
      timestampMillis: toMillisTimestamp(point.timestamp),
      timestampLabel: displayDateTime(point.timestamp).toFormat("HH:mm"),
      speedDisplay: Number(
        fromMetersPerSecond(point.speedMps, displaySpeedUnit).toFixed(2),
      ),
    }));

  return {
    date: refDate.toISO(),
    urlDate,
    password,
    chartData,
    summary: {
      points: pointRows.length,
      segments: routeSegments.length,
      averageSpeedDisplay: Number(
        fromMetersPerSecond(filteredAverageSpeedMps, displaySpeedUnit).toFixed(
          1,
        ),
      ),
      maxSpeedDisplay: Number(
        fromMetersPerSecond(filteredMaxSpeedMps, displaySpeedUnit).toFixed(1),
      ),
      chartSpeedCapDisplay: Number(
        fromMetersPerSecond(chartSpeedCapMps, displaySpeedUnit).toFixed(1),
      ),
      stopCount: filteredStopCount,
      slowestSegmentSpeedDisplay:
        filteredSlowestSegmentSpeedMps != null &&
        Number.isFinite(filteredSlowestSegmentSpeedMps)
          ? Number(
              fromMetersPerSecond(
                filteredSlowestSegmentSpeedMps,
                displaySpeedUnit,
              ).toFixed(1),
            )
          : null,
      speedUnit: displaySpeedUnit,
      speedUnitLabel,
      hasDeviceSpeed: inputSpeedUnit != null,
    },
    route: {
      points: pointsWithDerivedSpeed,
      segments: routeSegments,
    },
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const [hoveredPointId, setHoveredPointId] = useState<number | null>(null);
  const liveMapHref = `/${loaderData.password}/${loaderData.urlDate}/live`;
  const segmentSpeeds = loaderData.route.segments.map(
    (segment) => segment.speedDisplay,
  );
  const hasSegmentSpeeds = segmentSpeeds.length > 0;
  const speedRange = getSpeedRange(segmentSpeeds);
  const legendTicks = hasSegmentSpeeds ? buildLegendTicks(speedRange, 5) : [];
  const chartYAxisMax = Math.max(
    5,
    loaderData.summary.chartSpeedCapDisplay,
    loaderData.summary.maxSpeedDisplay * 1.05,
    loaderData.summary.averageSpeedDisplay,
  );
  const yAxisStep = getYAxisStep(chartYAxisMax);
  const normalizedChartYAxisMax =
    Math.ceil(chartYAxisMax / yAxisStep) * yAxisStep;
  const yAxisTicks = Array.from(
    { length: normalizedChartYAxisMax / yAxisStep + 1 },
    (_, index) => index * yAxisStep,
  );

  return (
    <Container fluid p="md">
      <Stack gap="md">
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
            <Title order={3}>
              {loaderData.summary.averageSpeedDisplay}{" "}
              {loaderData.summary.speedUnitLabel}
            </Title>
          </Card>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Maximum speed
            </Text>
            <Title order={3}>
              {loaderData.summary.maxSpeedDisplay}{" "}
              {loaderData.summary.speedUnitLabel}
            </Title>
          </Card>
        </SimpleGrid>

        <Card withBorder>
          <Group justify="space-between" align="center" mb="md">
            <div>
              <Title order={2}>Speed over time</Title>
              <Text c="dimmed" size="sm">
                {loaderData.summary.hasDeviceSpeed
                  ? "Uses this device's own reported speed. Readings it didn't report a speed for are skipped."
                  : "Derived from the tracked position samples for the day."}
              </Text>
            </div>
          </Group>
          {loaderData.chartData.length === 0 ? (
            <Center py="xl">
              <Stack align="center">
                <Title order={3}>No location data to analyse yet</Title>
                <Button component={Link} to={liveMapHref} variant="light">
                  Return to map
                </Button>
              </Stack>
            </Center>
          ) : (
            <SpeedChart
              data={loaderData.chartData}
              speedUnitLabel={loaderData.summary.speedUnitLabel}
              normalizedChartYAxisMax={normalizedChartYAxisMax}
              yAxisTicks={yAxisTicks}
              onHoveredPointIdChange={setHoveredPointId}
            />
          )}
        </Card>

        <Card withBorder>
          <Group justify="space-between" align="center" mb="md">
            <div>
              <Title order={2}>Route by speed</Title>
              <Text c="dimmed" size="sm">
                The path is split into segments and colored by speed: red is
                slowest, amber is mid pace, and green is fastest.
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
              speedUnit={loaderData.summary.speedUnit}
            />
          )}
        </Card>

        <Card withBorder>
          <Title order={2} mb="xs">
            Legend
          </Title>
          <Stack gap="xs">
            <Text c="dimmed" size="sm">
              Route segments are colored by speed for this day&apos;s range
              (slow red to fast green).
            </Text>
            {hasSegmentSpeeds ? (
              <>
                <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
                  {legendTicks.map((tick) => (
                    <Group key={tick.speedValue} gap="xs" wrap="nowrap">
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 999,
                          backgroundColor: tick.color,
                          flexShrink: 0,
                        }}
                      />
                      <Text size="sm">
                        {tick.speedValue.toFixed(1)}{" "}
                        {loaderData.summary.speedUnitLabel}
                      </Text>
                    </Group>
                  ))}
                </SimpleGrid>
                <Text c="dimmed" size="xs">
                  Min {speedRange.min.toFixed(1)}{" "}
                  {loaderData.summary.speedUnitLabel}, max{" "}
                  {speedRange.max.toFixed(1)}{" "}
                  {loaderData.summary.speedUnitLabel}.
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
