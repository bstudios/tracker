import { getDb } from "~/routeContext";
import { Anchor, Button, Container, Group, Table, Title } from "@mantine/core";
import {
  IconChevronLeft,
  IconCoffee,
  IconGasStation,
  IconHistory,
  IconList,
  IconTrain,
} from "@tabler/icons-react";
import { and, asc, between, eq, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { Link, type MetaFunction } from "react-router";
import { ensurePasswordAccess } from "~/passwordAccess.server";
import * as Schema from "~/database/schema.d";
import type { Route } from "./+types/timingPoints";

export const meta: MetaFunction = () => {
  return [{ title: "Timing Points" }];
};

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const { refDate, urlDate, password } = await ensurePasswordAccess({
    password: params.password,
    dateParam: params.date,
    request,
  });

  const startOfDay = refDate.startOf("day").toMillis();
  const endOfDay = refDate.endOf("day").toMillis();

  // All timing points applicable on the chosen date
  const selectedTimingPoints = getDb(context).$with("selected_timing_points").as(
    getDb(context)
      .select({
        id: Schema.TimingPoints.id,
        order: Schema.TimingPoints.order,
        name: Schema.TimingPoints.name,
        icon: Schema.TimingPoints.icon,
        googleLink: Schema.TimingPoints.googleLink,
        latitude: Schema.TimingPoints.latitude,
        longitude: Schema.TimingPoints.longitude,
      })
      .from(Schema.TimingPoints)
      .where(
        sql`EXISTS (
          SELECT 1 FROM json_each(${Schema.TimingPoints.applicableDates})
          WHERE value = ${urlDate}
        )`,
      ),
  );

  // Get all events for the day
  const dailyEvents = getDb(context).$with("daily_events").as(
    getDb(context)
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
      .where(between(Schema.Events.timestamp, startOfDay, endOfDay)),
  );

  // Get all events that are within the radius of the timing points that are applicable for the day
  const matchingEvents = getDb(context).$with("matching_events").as(
    getDb(context)
      .select({
        timing_point_id: Schema.TimingPoints.id,
        order: Schema.TimingPoints.order,
        event_id: dailyEvents.id,
        timestamp: dailyEvents.timestamp,
      })
      .from(Schema.TimingPoints)
      .innerJoin(dailyEvents, sql`1`)
      .where(
        and(
          sql`EXISTS (
            SELECT 1
            FROM json_each(${Schema.TimingPoints.applicableDates})
            WHERE value = ${urlDate}
          )`,
          sql`(${6371000 * 2} * ASIN(MIN(1.0, SQRT(
            SIN((${dailyEvents.event_latitude} - ${
              Schema.TimingPoints.latitude
            }) * 0.00872664626) *
            SIN((${dailyEvents.event_latitude} - ${
              Schema.TimingPoints.latitude
            }) * 0.00872664626) +
            COS(${Schema.TimingPoints.latitude} * 0.01745329252) *
            COS(${dailyEvents.event_latitude} * 0.01745329252) *
            SIN((${dailyEvents.event_longitude} - ${
              Schema.TimingPoints.longitude
            }) * 0.00872664626) *
            SIN((${dailyEvents.event_longitude} - ${
              Schema.TimingPoints.longitude
            }) * 0.00872664626)
          )))) <= ${Schema.TimingPoints.radius}`,
        ),
      ),
  );

  const rankedEvents = getDb(context).$with("ranked_events").as(
    getDb(context)
      .select({
        timing_point_id: matchingEvents.timing_point_id,
        order: matchingEvents.order,
        event_id: matchingEvents.event_id,
        timestamp: matchingEvents.timestamp,
        row_number_asc:
          sql<number>`ROW_NUMBER() OVER(PARTITION BY ${matchingEvents.timing_point_id} ORDER BY ${matchingEvents.timestamp} ASC)`.as(
            "row_number_asc",
          ),
        row_number_desc:
          sql<number>`ROW_NUMBER() OVER(PARTITION BY ${matchingEvents.timing_point_id} ORDER BY ${matchingEvents.timestamp} DESC)`.as(
            "row_number_desc",
          ),
        event_count:
          sql<number>`COUNT(*) OVER(PARTITION BY ${matchingEvents.timing_point_id})`.as(
            "event_count",
          ),
      })
      .from(matchingEvents),
  );

  // Aggregate events per timing point (arrival/departure/passage only)
  const aggregatedEvents = getDb(context).$with("aggregated_events").as(
    getDb(context)
      .select({
        timing_point_id: rankedEvents.timing_point_id,
        events:
          sql<string>`json_group_array(json_object('id', ${rankedEvents.event_id}, 'timestamp', ${rankedEvents.timestamp}, 'type', CASE WHEN ${rankedEvents.event_count} = 1 THEN 'passage' WHEN ${rankedEvents.row_number_asc} = 1 THEN 'arrival' WHEN ${rankedEvents.row_number_desc} = 1 THEN 'departure' END))`.as(
            "events",
          ),
      })
      .from(rankedEvents)
      .where(
        or(
          eq(rankedEvents.row_number_asc, 1),
          eq(rankedEvents.row_number_desc, 1),
        ),
      )
      .groupBy(rankedEvents.timing_point_id),
  );

  // Return all applicable timing points; include empty events where none matched
  const timingPointsWithEvents = await getDb(context)
    .with(
      selectedTimingPoints,
      dailyEvents,
      matchingEvents,
      rankedEvents,
      aggregatedEvents,
    )
    .select({
      timing_point_id: selectedTimingPoints.id,
      name: selectedTimingPoints.name,
      order: selectedTimingPoints.order,
      icon: selectedTimingPoints.icon,
      googleLink: selectedTimingPoints.googleLink,
      latitude: selectedTimingPoints.latitude,
      longitude: selectedTimingPoints.longitude,
      events: sql<string>`coalesce(${aggregatedEvents.events}, '[]')`.as(
        "events",
      ),
    })
    .from(selectedTimingPoints)
    .leftJoin(
      aggregatedEvents,
      eq(selectedTimingPoints.id, aggregatedEvents.timing_point_id),
    )
    .orderBy(asc(selectedTimingPoints.order));

  return {
    timingPoints: timingPointsWithEvents as {
      timing_point_id: number;
      name: string;
      order: number;
      events: string;
      icon: string | null;
      googleLink: string | null;
      latitude: number;
      longitude: number;
    }[],
    date: urlDate,
    password,
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <Container fluid p={"md"}>
      <Group>
        <Button
          leftSection={<IconChevronLeft />}
          component={Link}
          to={`/${loaderData.password}/${loaderData.date}`}
        >
          Back to Map
        </Button>
        <Button
          leftSection={<IconList />}
          href={`/${loaderData.password}/${loaderData.date}/table`}
          component="a"
        >
          View Full History
        </Button>
        <Button
          leftSection={<IconHistory />}
          href={`/${loaderData.password}/${loaderData.date}/timingsHistoric`}
          component="a"
        >
          Compare to Other Dates
        </Button>
        <Title order={1}>History at Timing Points</Title>
      </Group>
      {loaderData.timingPoints.length === 0 ? (
        <Title>No data available</Title>
      ) : (
        <Table striped highlightOnHover stickyHeader stickyHeaderOffset={0}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Location</Table.Th>
              <Table.Th>Arrived</Table.Th>
              <Table.Th>Departed</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loaderData.timingPoints.map((timingPoint) => {
              const events = JSON.parse(timingPoint.events) as {
                id: number;
                timestamp: number;
                type: "passage" | "arrival" | "departure";
              }[];
              return (
                <Table.Tr key={timingPoint.timing_point_id}>
                  <Table.Td>
                    <Group justify="flex-start">
                      {timingPoint.icon === "IconCoffee" ? (
                        <IconCoffee />
                      ) : timingPoint.icon === "IconGasStation" ? (
                        <IconGasStation />
                      ) : timingPoint.icon === "IconTrain" ? (
                        <IconTrain />
                      ) : null}
                      <Anchor
                        c="inherit"
                        component={Link}
                        to={
                          timingPoint.googleLink ??
                          `https://www.google.com/maps?q=${timingPoint.latitude},${timingPoint.longitude}`
                        }
                        target="_blank"
                      >
                        {timingPoint.name}
                      </Anchor>
                    </Group>
                  </Table.Td>
                  {events.length === 0 && <Table.Td colSpan={2}></Table.Td>}
                  {events.length === 1 && events[0].type === "passage" && (
                    <Table.Td colSpan={2}>
                      {DateTime.fromSeconds(events[0].timestamp / 1000, {
                        zone: "Europe/London",
                      }).toLocaleString(DateTime.TIME_24_SIMPLE)}
                    </Table.Td>
                  )}
                  {events.length === 2 && (
                    <>
                      {(() => {
                        const arrivalEvent = events.find(
                          (event) => event.type === "arrival",
                        );
                        const departureEvent = events.find(
                          (event) => event.type === "departure",
                        );
                        if (!arrivalEvent || !departureEvent) {
                          return <Table.Td colSpan={2}></Table.Td>;
                        }
                        if (
                          (departureEvent?.timestamp ?? 0) -
                            (arrivalEvent?.timestamp ?? 0) <=
                          1000 * 120 // 2 minutes
                        )
                          return (
                            <Table.Td colSpan={2}>
                              {DateTime.fromSeconds(
                                arrivalEvent.timestamp / 1000,
                                { zone: "Europe/London" },
                              ).toLocaleString(DateTime.TIME_24_SIMPLE)}
                            </Table.Td>
                          ); // If the difference between the arrival and departure times is less than 2 minutes, then just show the arrival time
                        return (
                          <>
                            <Table.Td>
                              {DateTime.fromSeconds(
                                arrivalEvent.timestamp / 1000,
                                { zone: "Europe/London" },
                              ).toLocaleString(DateTime.TIME_24_SIMPLE)}
                            </Table.Td>
                            <Table.Td>
                              {DateTime.fromSeconds(
                                departureEvent.timestamp / 1000,
                                { zone: "Europe/London" },
                              ).toLocaleString(DateTime.TIME_24_SIMPLE)}{" "}
                              (
                              {DateTime.fromSeconds(
                                departureEvent.timestamp / 1000,
                                { zone: "Europe/London" },
                              ).toRelative({
                                base: DateTime.fromSeconds(
                                  arrivalEvent.timestamp / 1000,
                                  { zone: "Europe/London" },
                                ),
                                style: "short",
                              })}
                              )
                            </Table.Td>
                          </>
                        );
                      })()}
                    </>
                  )}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
}
