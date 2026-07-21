import { getDb, getPasswordRouteAccess } from "~/routeContext";
import { Anchor, Container, Group, Table, Title } from "@mantine/core";
import { IconCoffee, IconGasStation, IconTrain } from "@tabler/icons-react";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { Link, type MetaFunction } from "react-router";
import * as Schema from "~/database/schema.d";
import type { Route } from "./+types/timingPoints";

export const meta: MetaFunction = () => {
  return [{ title: "Timing Points" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(context);

  const { urlDate, password, deviceId } = getPasswordRouteAccess(context);

  // All timing points applicable on the chosen date
  const selectedTimingPoints = db.$with("selected_timing_points").as(
    db
      .select({
        id: Schema.TimingPoints.id,
        order: Schema.TimingPoints.order,
        name: Schema.TimingPoints.name,
        icon: Schema.TimingPoints.icon,
        googleLink: Schema.TimingPoints.googleLink,
        timing_point_latitude: sql<number>`${Schema.TimingPoints.latitude}`.as(
          "timing_point_latitude",
        ),
        timing_point_longitude: sql<number>`${Schema.TimingPoints.longitude}`.as(
          "timing_point_longitude",
        ),
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

  // Get all events for the day
  const dailyEvents = db.$with("daily_events").as(
    db
      .select({
        id: Schema.Events.id,
        timestamp: Schema.Events.timestamp,
        event_latitude: sql<number>`${Schema.Events.latitude}`.as(
          "event_latitude",
        ),
        event_longitude: sql<number>`${Schema.Events.longitude}`.as(
          "event_longitude",
        ),
        event_h3_index: sql<string>`${Schema.Events.h3Index}`.as(
          "event_h3_index",
        ),
      })
      .from(Schema.Events)
      .where(
        and(
          eq(Schema.Events.deviceId, deviceId),
          eq(Schema.Events.dateString, urlDate),
        ),
      ),
  );

  const candidateEvents = db.$with("candidate_events").as(
    db
      .select({
        timing_point_id: selectedTimingPoints.id,
        order: selectedTimingPoints.order,
        radius: selectedTimingPoints.radius,
        timing_point_latitude: sql<number>`${selectedTimingPoints.timing_point_latitude}`.as(
          "timing_point_latitude",
        ),
        timing_point_longitude: sql<number>`${selectedTimingPoints.timing_point_longitude}`.as(
          "timing_point_longitude",
        ),
        event_id: dailyEvents.id,
        timestamp: dailyEvents.timestamp,
        event_latitude: dailyEvents.event_latitude,
        event_longitude: dailyEvents.event_longitude,
      })
      .from(selectedTimingPoints)
      .innerJoin(
        Schema.TimingPointH3Cells,
        eq(Schema.TimingPointH3Cells.timingPointId, selectedTimingPoints.id),
      )
      .innerJoin(
        dailyEvents,
        eq(dailyEvents.event_h3_index, Schema.TimingPointH3Cells.h3Index),
      ),
  );

  // Get all events that are within the radius of the timing points that are applicable for the day
  const matchingEvents = db.$with("matching_events").as(
    db
      .select({
        timing_point_id: candidateEvents.timing_point_id,
        order: candidateEvents.order,
        event_id: candidateEvents.event_id,
        timestamp: candidateEvents.timestamp,
      })
      .from(candidateEvents)
      .where(
        sql`(${6371000 * 2} * ASIN(MIN(1.0, SQRT(
          SIN((${candidateEvents.event_latitude} - ${candidateEvents.timing_point_latitude}) * 0.00872664626) *
          SIN((${candidateEvents.event_latitude} - ${candidateEvents.timing_point_latitude}) * 0.00872664626) +
          COS(${candidateEvents.timing_point_latitude} * 0.01745329252) *
          COS(${candidateEvents.event_latitude} * 0.01745329252) *
          SIN((${candidateEvents.event_longitude} - ${candidateEvents.timing_point_longitude}) * 0.00872664626) *
          SIN((${candidateEvents.event_longitude} - ${candidateEvents.timing_point_longitude}) * 0.00872664626)
        )))) <= ${candidateEvents.radius}`,
      ),
  );

  const rankedEvents = db.$with("ranked_events").as(
    db
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
  const aggregatedEvents = db.$with("aggregated_events").as(
    db
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
  const timingPointsWithEvents = await db
    .with(
      selectedTimingPoints,
      dailyEvents,
      candidateEvents,
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
      latitude: selectedTimingPoints.timing_point_latitude,
      longitude: selectedTimingPoints.timing_point_longitude,
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
