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
import { and, asc, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { useState } from "react";
import { Link, type MetaFunction } from "react-router";
import { AnalysisMap } from "~/components/AnalysisMap/AnalysisMap";
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

  const events = await getDb(context)
    .select({
      id: Schema.Events.id,
      timestamp: Schema.Events.timestamp,
      data: Schema.Events.data,
    })
    .from(Schema.Events)
    .orderBy(asc(Schema.Events.timestamp))
    .where(
      and(
        gte(Schema.Events.timestamp, refDate.toMillis()),
        lte(Schema.Events.timestamp, refDate.toMillis() + 86400000),
      ),
    );

  const eventsWithLocation = events
    .filter(
      (event) =>
        "latitude" in event.data.location && "longitude" in event.data.location,
    )
    .map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      latitude: event.data.location.latitude,
      longitude: event.data.location.longitude,
      speed: event.data.location.speed,
    }));

  const segments = eventsWithLocation.slice(1).map((point, index) => {
    const previousPoint = eventsWithLocation[index];
    const timeDeltaSeconds = (point.timestamp - previousPoint.timestamp) / 1000;
    const speedMph = point.speed * MPS_TO_MPH;
    const isStop = point.speed < 0.5;

    return {
      id: `${previousPoint.id}-${point.id}`,
      timestamp: point.timestamp,
      timeDeltaSeconds,
      speedMph,
      isStop,
      positions: [
        [previousPoint.latitude, previousPoint.longitude],
        [point.latitude, point.longitude],
      ] as [number, number][],
    };
  });

  const averageSpeedMph =
    eventsWithLocation.length === 0
      ? 0
      : eventsWithLocation.reduce(
          (sum, point) => sum + point.speed * MPS_TO_MPH,
          0,
        ) / eventsWithLocation.length;

  const maxSpeedMph = eventsWithLocation.reduce(
    (max, point) => Math.max(max, point.speed * MPS_TO_MPH),
    0,
  );

  const stopCount = segments.filter((segment) => segment.isStop).length;
  const slowestSegment = segments.reduce(
    (slowest, segment) =>
      !slowest || segment.speedMph < slowest.speedMph ? segment : slowest,
    null as (typeof segments)[number] | null,
  );

  const chartData = eventsWithLocation.map((point) => ({
    pointId: point.id,
    timestampMillis: point.timestamp,
    speedMph: Number((point.speed * MPS_TO_MPH).toFixed(2)),
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
      points: eventsWithLocation.length,
      segments: segments.length,
      averageSpeedMph: Number(averageSpeedMph.toFixed(1)),
      maxSpeedMph: Number(maxSpeedMph.toFixed(1)),
      stopCount,
      slowestSegmentSpeedMph: slowestSegment
        ? Number(slowestSegment.speedMph.toFixed(1))
        : null,
    },
    route: {
      points: eventsWithLocation,
      segments,
    },
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const [hoveredPointId, setHoveredPointId] = useState<number | null>(null);
  const backToMapHref = `/${loaderData.password}/${loaderData.urlDate}`;

  const lineChartInteractionProps: {
    onMouseMove: (event: unknown) => void;
    onMouseLeave: () => void;
  } = {
    onMouseMove: (event) => {
      const pointId =
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
              Route segments are colored by speed:
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
              <Group gap="xs" wrap="nowrap">
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    backgroundColor: "#7c3aed",
                    flexShrink: 0,
                  }}
                />
                <Text size="sm">Under 1 mph</Text>
              </Group>
              <Group gap="xs" wrap="nowrap">
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    backgroundColor: "#2563eb",
                    flexShrink: 0,
                  }}
                />
                <Text size="sm">1 to 12 mph</Text>
              </Group>
              <Group gap="xs" wrap="nowrap">
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    backgroundColor: "#16a34a",
                    flexShrink: 0,
                  }}
                />
                <Text size="sm">12 to 31 mph</Text>
              </Group>
              <Group gap="xs" wrap="nowrap">
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    backgroundColor: "#f59e0b",
                    flexShrink: 0,
                  }}
                />
                <Text size="sm">31 to 50 mph</Text>
              </Group>
              <Group gap="xs" wrap="nowrap">
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    backgroundColor: "#dc2626",
                    flexShrink: 0,
                  }}
                />
                <Text size="sm">Over 50 mph</Text>
              </Group>
            </SimpleGrid>
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
