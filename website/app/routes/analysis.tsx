import {
  Button,
  Card,
  Center,
  Container,
  Group,
  MantineProvider,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Table,
} from "@mantine/core";
import { LineChart } from "@mantine/charts";
import { and, asc, eq, gte, lte, or, sql } from "drizzle-orm";
import { divIcon } from "leaflet";
import "leaflet/dist/leaflet.css";
import { DateTime } from "luxon";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Link, type MetaFunction } from "react-router";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";
import { ensurePasswordAccess } from "~/passwordAccess.server";
import * as Schema from "~/database/schema.d";
import { theme } from "~/root";
import type { Route } from "./+types/analysis";

export const meta: MetaFunction = () => {
  return [{ title: "Rally Analysis" }];
};

export async function loader({ context, params, request }: Route.LoaderArgs) {
  if (!params.password) {
    throw new Response("Missing password", { status: 400 });
  }

  const { refDate, urlDate, password } = await ensurePasswordAccess({
    password: params.password,
    dateParam: params.date,
    request,
  });

  const events = await context.db
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
    const speedKph = point.speed * 3.6;
    const isStop = point.speed < 0.5;

    return {
      id: `${previousPoint.id}-${point.id}`,
      timestamp: point.timestamp,
      timeDeltaSeconds,
      speedKph,
      isStop,
      positions: [
        [previousPoint.latitude, previousPoint.longitude],
        [point.latitude, point.longitude],
      ] as [number, number][],
    };
  });

  const averageSpeedKph =
    eventsWithLocation.length === 0
      ? 0
      : eventsWithLocation.reduce((sum, point) => sum + point.speed * 3.6, 0) /
        eventsWithLocation.length;

  const maxSpeedKph = eventsWithLocation.reduce(
    (max, point) => Math.max(max, point.speed * 3.6),
    0,
  );

  const stopCount = segments.filter((segment) => segment.isStop).length;
  const slowestSegment = segments.reduce(
    (slowest, segment) =>
      !slowest || segment.speedKph < slowest.speedKph ? segment : slowest,
    null as (typeof segments)[number] | null,
  );

  const chartData = eventsWithLocation.map((point) => ({
    time: DateTime.fromSeconds(point.timestamp / 1000, {
      zone: "Europe/London",
    }).toFormat("HH:mm"),
    speedKph: Number((point.speed * 3.6).toFixed(2)),
  }));

  const startOfDay = refDate.startOf("day").toMillis();
  const endOfDay = refDate.endOf("day").toMillis();

  const selectedTimingPoints = context.db.$with("selected_timing_points").as(
    context.db
      .select({
        id: Schema.TimingPoints.id,
        order: Schema.TimingPoints.order,
        name: Schema.TimingPoints.name,
        icon: Schema.TimingPoints.icon,
        googleLink: Schema.TimingPoints.googleLink,
        latitude: Schema.TimingPoints.latitude,
        longitude: Schema.TimingPoints.longitude,
        radius: Schema.TimingPoints.radius,
      })
      .from(Schema.TimingPoints)
      .where(
        sql`EXISTS (
          SELECT 1 FROM json_each(${Schema.TimingPoints.applicableDates})
          WHERE value = ${urlDate}
        )`,
      ),
  );

  const dailyEvents = context.db.$with("daily_events").as(
    context.db
      .select({
        id: Schema.Events.id,
        timestamp: Schema.Events.timestamp,
        event_latitude:
          sql<number>`json_extract(data, '$.location.latitude')`.as(
            "event_latitude",
          ),
        event_longitude:
          sql<number>`json_extract(data, '$.location.longitude')`.as(
            "event_longitude",
          ),
      })
      .from(Schema.Events)
      .where(
        and(
          gte(Schema.Events.timestamp, startOfDay),
          lte(Schema.Events.timestamp, endOfDay),
        ),
      ),
  );

  const matchingTimingEvents = context.db.$with("matching_timing_events").as(
    context.db
      .select({
        timing_point_id: Schema.TimingPoints.id,
        order: Schema.TimingPoints.order,
        name: Schema.TimingPoints.name,
        event_id: dailyEvents.id,
        timestamp: dailyEvents.timestamp,
      })
      .from(Schema.TimingPoints)
      .innerJoin(dailyEvents, sql`1`)
      .where(
        and(
          sql`EXISTS (
            SELECT 1 FROM json_each(${Schema.TimingPoints.applicableDates})
            WHERE value = ${urlDate}
          )`,
          sql`(${6371000 * 2} * ASIN(MIN(1.0, SQRT(
            SIN((${dailyEvents.event_latitude} - ${Schema.TimingPoints.latitude}) * 0.00872664626) *
            SIN((${dailyEvents.event_latitude} - ${Schema.TimingPoints.latitude}) * 0.00872664626) +
            COS(${Schema.TimingPoints.latitude} * 0.01745329252) *
            COS(${dailyEvents.event_latitude} * 0.01745329252) *
            SIN((${dailyEvents.event_longitude} - ${Schema.TimingPoints.longitude}) * 0.00872664626) *
            SIN((${dailyEvents.event_longitude} - ${Schema.TimingPoints.longitude}) * 0.00872664626)
          )))) <= ${Schema.TimingPoints.radius}`,
        ),
      ),
  );

  const rankedTimingEvents = context.db.$with("ranked_timing_events").as(
    context.db
      .select({
        timing_point_id: matchingTimingEvents.timing_point_id,
        order: matchingTimingEvents.order,
        name: matchingTimingEvents.name,
        event_id: matchingTimingEvents.event_id,
        timestamp: matchingTimingEvents.timestamp,
        row_number_asc:
          sql<number>`ROW_NUMBER() OVER(PARTITION BY ${matchingTimingEvents.timing_point_id} ORDER BY ${matchingTimingEvents.timestamp} ASC)`.as(
            "row_number_asc",
          ),
        row_number_desc:
          sql<number>`ROW_NUMBER() OVER(PARTITION BY ${matchingTimingEvents.timing_point_id} ORDER BY ${matchingTimingEvents.timestamp} DESC)`.as(
            "row_number_desc",
          ),
        event_count:
          sql<number>`COUNT(*) OVER(PARTITION BY ${matchingTimingEvents.timing_point_id})`.as(
            "event_count",
          ),
      })
      .from(matchingTimingEvents),
  );

  const aggregatedTimingEvents = context.db
    .$with("aggregated_timing_events")
    .as(
      context.db
        .select({
          timing_point_id: rankedTimingEvents.timing_point_id,
          events:
            sql<string>`json_group_array(json_object('id', ${rankedTimingEvents.event_id}, 'timestamp', ${rankedTimingEvents.timestamp}, 'type', CASE WHEN ${rankedTimingEvents.event_count} = 1 THEN 'passage' WHEN ${rankedTimingEvents.row_number_asc} = 1 THEN 'arrival' WHEN ${rankedTimingEvents.row_number_desc} = 1 THEN 'departure' END))`.as(
              "events",
            ),
        })
        .from(rankedTimingEvents)
        .where(
          or(
            eq(rankedTimingEvents.row_number_asc, 1),
            eq(rankedTimingEvents.row_number_desc, 1),
          ),
        )
        .groupBy(rankedTimingEvents.timing_point_id),
    );

  const timingPoints = await context.db
    .with(
      selectedTimingPoints,
      dailyEvents,
      matchingTimingEvents,
      rankedTimingEvents,
      aggregatedTimingEvents,
    )
    .select({
      timing_point_id: selectedTimingPoints.id,
      name: selectedTimingPoints.name,
      order: selectedTimingPoints.order,
      icon: selectedTimingPoints.icon,
      googleLink: selectedTimingPoints.googleLink,
      latitude: selectedTimingPoints.latitude,
      longitude: selectedTimingPoints.longitude,
      events: sql<string>`coalesce(${aggregatedTimingEvents.events}, '[]')`.as(
        "events",
      ),
    })
    .from(selectedTimingPoints)
    .leftJoin(
      aggregatedTimingEvents,
      eq(selectedTimingPoints.id, aggregatedTimingEvents.timing_point_id),
    )
    .orderBy(asc(selectedTimingPoints.order));

  const timingPointSummary = timingPoints.map((timingPoint) => {
    const events = JSON.parse(timingPoint.events) as {
      id: number;
      timestamp: number;
      type: "passage" | "arrival" | "departure";
    }[];
    const arrivalEvent = events.find((event) => event.type === "arrival");
    const departureEvent = events.find((event) => event.type === "departure");
    const passageEvent = events.find((event) => event.type === "passage");

    return {
      id: timingPoint.timing_point_id,
      name: timingPoint.name,
      googleLink: timingPoint.googleLink,
      latitude: timingPoint.latitude,
      longitude: timingPoint.longitude,
      eventCount: events.length,
      arrival: arrivalEvent?.timestamp ?? null,
      departure: departureEvent?.timestamp ?? null,
      passage: passageEvent?.timestamp ?? null,
      dwellSeconds:
        arrivalEvent && departureEvent
          ? Math.max(
              0,
              (departureEvent.timestamp - arrivalEvent.timestamp) / 1000,
            )
          : null,
    };
  });

  return {
    date: refDate.toISO(),
    urlDate,
    password,
    chartData,
    summary: {
      points: eventsWithLocation.length,
      segments: segments.length,
      averageSpeedKph: Number(averageSpeedKph.toFixed(1)),
      maxSpeedKph: Number(maxSpeedKph.toFixed(1)),
      stopCount,
      slowestSegmentSpeedKph: slowestSegment
        ? Number(slowestSegment.speedKph.toFixed(1))
        : null,
    },
    route: {
      points: eventsWithLocation,
      segments,
    },
    timingPoints: timingPointSummary,
  };
}

const mapIcon = (children: ReactNode) =>
  divIcon({
    html: renderToStaticMarkup(
      <MantineProvider theme={theme}>{children}</MantineProvider>,
    ),
    iconSize: [20, 20],
    className: "myDivIcon",
  });

const speedColor = (speedKph: number) => {
  if (speedKph < 1) return "#7c3aed";
  if (speedKph < 20) return "#2563eb";
  if (speedKph < 50) return "#16a34a";
  if (speedKph < 80) return "#f59e0b";
  return "#dc2626";
};

export default function Page({ loaderData }: Route.ComponentProps) {
  const backToMapHref = `/${loaderData.password}/${loaderData.urlDate}`;
  const routeCenter = loaderData.route.points[0]
    ? ([
        loaderData.route.points[0].latitude,
        loaderData.route.points[0].longitude,
      ] as [number, number])
    : ([0, 0] as [number, number]);

  return (
    <Container fluid p="md">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Group>
            <Button component={Link} to={backToMapHref} variant="light">
              Back to live map
            </Button>
            <Title order={1}>Rally Analysis</Title>
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
            <Title order={3}>{loaderData.summary.averageSpeedKph} km/h</Title>
          </Card>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Maximum speed
            </Text>
            <Title order={3}>{loaderData.summary.maxSpeedKph} km/h</Title>
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
              {loaderData.summary.slowestSegmentSpeedKph ?? "n/a"} km/h
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
              dataKey="time"
              series={[
                { name: "speedKph", color: "pink.6", label: "Speed (km/h)" },
              ]}
              curveType="linear"
              withDots={false}
              withLegend
              tickLine="y"
              withXAxis
              withYAxis
              gridAxis="y"
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
            <div style={{ height: 420, width: "100%" }}>
              <MapContainer
                center={routeCenter}
                zoom={13}
                scrollWheelZoom={false}
                touchZoom={true}
                style={{ height: 420, width: "100%", zIndex: 0 }}
                attributionControl={false}
              >
                <TileLayer
                  attribution='Map &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {loaderData.route.segments.map((segment) => (
                  <Polyline
                    key={segment.id}
                    positions={segment.positions}
                    pathOptions={{
                      color: speedColor(segment.speedKph),
                      weight: 5,
                    }}
                  />
                ))}
                {loaderData.route.points.map((point, index) => (
                  <Marker
                    key={`${point.id}-${index}`}
                    position={[point.latitude, point.longitude]}
                    icon={mapIcon(
                      <ThemeIcon radius="xl" size="sm" color="pink">
                        {index === 0
                          ? "S"
                          : index === loaderData.route.points.length - 1
                            ? "F"
                            : "•"}
                      </ThemeIcon>,
                    )}
                  >
                    <Popup>
                      <Text>
                        {DateTime.fromSeconds(point.timestamp / 1000, {
                          zone: "Europe/London",
                        }).toLocaleString(DateTime.DATETIME_MED)}
                      </Text>
                      <Text size="sm">
                        {(point.speed * 3.6).toFixed(1)} km/h
                      </Text>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          )}
        </Card>

        <Card withBorder>
          <Title order={2} mb="xs">
            Next steps
          </Title>
          <Text c="dimmed">
            This page is the first split from the live map. The next slice can
            move route coloring, replay, and timing-point comparisons here
            without increasing the tracking page payload.
          </Text>
        </Card>

        <Card withBorder>
          <Group justify="space-between" align="center" mb="md">
            <div>
              <Title order={2}>Timing-point debrief</Title>
              <Text c="dimmed" size="sm">
                Arrival, passage, departure, and dwell-time summary for the
                selected day.
              </Text>
            </div>
          </Group>
          {loaderData.timingPoints.length === 0 ? (
            <Text c="dimmed">
              No timing points were configured for this date.
            </Text>
          ) : (
            <Table striped highlightOnHover stickyHeader stickyHeaderOffset={0}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Location</Table.Th>
                  <Table.Th>Arrived</Table.Th>
                  <Table.Th>Departed</Table.Th>
                  <Table.Th>Dwell</Table.Th>
                  <Table.Th>Events</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {loaderData.timingPoints.map((timingPoint) => (
                  <Table.Tr key={timingPoint.id}>
                    <Table.Td>
                      <Text>
                        {timingPoint.googleLink ? (
                          <Link to={timingPoint.googleLink} target="_blank">
                            {timingPoint.name}
                          </Link>
                        ) : (
                          timingPoint.name
                        )}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {timingPoint.arrival
                        ? DateTime.fromSeconds(timingPoint.arrival / 1000, {
                            zone: "Europe/London",
                          }).toLocaleString(DateTime.TIME_24_SIMPLE)
                        : ""}
                    </Table.Td>
                    <Table.Td>
                      {timingPoint.departure
                        ? DateTime.fromSeconds(timingPoint.departure / 1000, {
                            zone: "Europe/London",
                          }).toLocaleString(DateTime.TIME_24_SIMPLE)
                        : timingPoint.passage
                          ? DateTime.fromSeconds(timingPoint.passage / 1000, {
                              zone: "Europe/London",
                            }).toLocaleString(DateTime.TIME_24_SIMPLE)
                          : ""}
                    </Table.Td>
                    <Table.Td>
                      {timingPoint.dwellSeconds === null
                        ? ""
                        : timingPoint.dwellSeconds < 120
                          ? "under 2 min"
                          : `${Math.round(timingPoint.dwellSeconds / 60)} min`}
                    </Table.Td>
                    <Table.Td>{timingPoint.eventCount}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Card>
      </Stack>
    </Container>
  );
}
