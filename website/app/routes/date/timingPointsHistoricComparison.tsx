import { getDb, getPasswordRouteAccess } from "~/routeContext";
import { Container, Table, Title } from "@mantine/core";
import { asc, eq, or, sql } from "drizzle-orm";
import { type MetaFunction } from "react-router";
import * as Schema from "~/database/schema.d";
import { formatTime24 } from "~/utils/dateTime";
import type { Route } from "./+types/timingPointsHistoricComparison";

export const meta: MetaFunction = () => {
  return [{ title: "Timing Points" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(context);

  const { urlDate, password, deviceId } = getPasswordRouteAccess(context);

  // Select the timing points belonging to the device we are looking at
  const selectedTimingPoints = db.$with("selected_timing_points").as(
    db
      .select({
        id: Schema.TimingPoints.id,
        name: Schema.TimingPoints.name,
        order: Schema.TimingPoints.order,
        timing_point_latitude: sql<number>`${Schema.TimingPoints.latitude}`.as(
          "timing_point_latitude",
        ),
        timing_point_longitude:
          sql<number>`${Schema.TimingPoints.longitude}`.as(
            "timing_point_longitude",
          ),
        radius: Schema.TimingPoints.radius,
      })
      .from(Schema.TimingPoints)
      .where(eq(Schema.TimingPoints.deviceId, deviceId)),
  );

  // All of the device's events near its timing points, across every date it has data for.
  // Timing points are no longer pinned to dates, so the dates we compare against are simply
  // whichever dates this device actually has timing point matches on.
  const dateEvents = db.$with("date_events").as(
    db
      .select({
        timing_point_id: selectedTimingPoints.id,
        name: selectedTimingPoints.name,
        order: selectedTimingPoints.order,
        timing_point_latitude:
          sql<number>`${selectedTimingPoints.timing_point_latitude}`.as(
            "timing_point_latitude",
          ),
        timing_point_longitude:
          sql<number>`${selectedTimingPoints.timing_point_longitude}`.as(
            "timing_point_longitude",
          ),
        radius: selectedTimingPoints.radius,
        date: Schema.Events.dateString,
        event_id: Schema.Events.id,
        timestamp: Schema.Events.timestamp,
        event_latitude: sql<number>`${Schema.Events.latitude}`.as(
          "event_latitude",
        ),
        event_longitude: sql<number>`${Schema.Events.longitude}`.as(
          "event_longitude",
        ),
      })
      .from(selectedTimingPoints)
      .innerJoin(
        Schema.TimingPointH3Cells,
        eq(Schema.TimingPointH3Cells.timingPointId, selectedTimingPoints.id),
      )
      .innerJoin(
        Schema.Events,
        eq(Schema.Events.h3Index, Schema.TimingPointH3Cells.h3Index),
      )
      .where(eq(Schema.Events.deviceId, deviceId)),
  );

  // Filter events that are within the timing point radius for that date
  const matchingEvents = db.$with("matching_events").as(
    db
      .select({
        timing_point_id: dateEvents.timing_point_id,
        name: dateEvents.name,
        order: dateEvents.order,
        date: dateEvents.date,
        event_id: dateEvents.event_id,
        timestamp: dateEvents.timestamp,
      })
      .from(dateEvents)
      .where(
        sql`(${6371000 * 2} * ASIN(MIN(1.0, SQRT(
          SIN((${dateEvents.event_latitude} - ${
            dateEvents.timing_point_latitude
          }) * 0.00872664626) *
          SIN((${dateEvents.event_latitude} - ${
            dateEvents.timing_point_latitude
          }) * 0.00872664626) +
          COS(${dateEvents.timing_point_latitude} * 0.01745329252) *
          COS(${dateEvents.event_latitude} * 0.01745329252) *
          SIN((${dateEvents.event_longitude} - ${
            dateEvents.timing_point_longitude
          }) * 0.00872664626) *
          SIN((${dateEvents.event_longitude} - ${
            dateEvents.timing_point_longitude
          }) * 0.00872664626)
        )))) <= ${dateEvents.radius}`,
      ),
  );

  // Rank events per timing_point/date to determine arrival/departure
  const rankedEvents = db.$with("ranked_events").as(
    db
      .select({
        timing_point_id: matchingEvents.timing_point_id,
        name: matchingEvents.name,
        order: matchingEvents.order,
        date: matchingEvents.date,
        event_id: matchingEvents.event_id,
        timestamp: matchingEvents.timestamp,
        row_number_asc:
          sql<number>`ROW_NUMBER() OVER(PARTITION BY ${matchingEvents.timing_point_id}, ${matchingEvents.date} ORDER BY ${matchingEvents.timestamp} ASC)`.as(
            "row_number_asc",
          ),
        row_number_desc:
          sql<number>`ROW_NUMBER() OVER(PARTITION BY ${matchingEvents.timing_point_id}, ${matchingEvents.date} ORDER BY ${matchingEvents.timestamp} DESC)`.as(
            "row_number_desc",
          ),
        event_count:
          sql<number>`COUNT(*) OVER(PARTITION BY ${matchingEvents.timing_point_id}, ${matchingEvents.date})`.as(
            "event_count",
          ),
      })
      .from(matchingEvents),
  );

  // For each timing_point/date, keep only arrival/departure/passage and aggregate
  const timingPointsByDate = await db
    .with(selectedTimingPoints, dateEvents, matchingEvents, rankedEvents)
    .select({
      timing_point_id: rankedEvents.timing_point_id,
      name: rankedEvents.name,
      order: rankedEvents.order,
      date: rankedEvents.date,
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
    .groupBy(
      rankedEvents.timing_point_id,
      rankedEvents.name,
      rankedEvents.order,
      sql`${rankedEvents.date}`,
    )
    .orderBy(asc(rankedEvents.order), asc(rankedEvents.date));

  // Also fetch all of the device's timing points (even if they have no events)
  const deviceTimingPoints = await db
    .with(selectedTimingPoints)
    .select({
      id: selectedTimingPoints.id,
      name: selectedTimingPoints.name,
      order: selectedTimingPoints.order,
    })
    .from(selectedTimingPoints)
    .orderBy(asc(selectedTimingPoints.order));

  // Pre-compute date columns and grouped rows server-side.
  // The comparison columns are every date this device has timing point matches on, plus the
  // date currently being viewed so it is always shown even when nothing matched that day.
  const dates = Array.from(
    new Set([
      urlDate,
      ...(timingPointsByDate as { date: string }[]).map((r) => r.date),
    ]),
  ).sort();

  const grouped: Record<
    number,
    {
      name: string;
      order: number;
      byDate: Record<
        string,
        {
          id: number;
          timestamp: number;
          type: "passage" | "arrival" | "departure";
        }[]
      >;
    }
  > = {};

  for (const row of timingPointsByDate as {
    timing_point_id: number;
    name: string;
    order: number;
    date: string;
    events: string;
  }[]) {
    const events = JSON.parse(row.events) as {
      id: number;
      timestamp: number;
      type: "passage" | "arrival" | "departure";
    }[];
    if (!grouped[row.timing_point_id]) {
      grouped[row.timing_point_id] = {
        name: row.name,
        order: row.order,
        byDate: {},
      };
    }
    grouped[row.timing_point_id].byDate[row.date] = events;
  }

  // Ensure timing points with no events are included
  for (const tp of deviceTimingPoints as {
    id: number;
    name: string;
    order: number;
  }[]) {
    if (!grouped[tp.id]) {
      grouped[tp.id] = { name: tp.name, order: tp.order, byDate: {} };
    }
  }

  const rows = Object.entries(grouped)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([tpId, info]) => ({
      timing_point_id: Number(tpId),
      name: info.name,
      order: info.order,
      byDate: info.byDate,
    }));

  return {
    dates,
    rows: rows as {
      timing_point_id: number;
      name: string;
      order: number;
      byDate: Record<
        string,
        {
          id: number;
          timestamp: number;
          type: "passage" | "arrival" | "departure";
        }[]
      >;
    }[],
    date: urlDate,
    password,
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <Container fluid p={"md"}>
      {loaderData.rows.length === 0 ? (
        <Title>No data available</Title>
      ) : (
        <Table striped highlightOnHover stickyHeader stickyHeaderOffset={0}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Location</Table.Th>
              {loaderData.dates.flatMap((d: string) => [
                <Table.Th key={`${d}-arr`}>{d} Arrived</Table.Th>,
                <Table.Th key={`${d}-dep`}>{d} Departed</Table.Th>,
              ])}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loaderData.rows.map(
              (row: {
                timing_point_id: number;
                name: string;
                byDate: Record<
                  string,
                  {
                    id: number;
                    timestamp: number;
                    type: "passage" | "arrival" | "departure";
                  }[]
                >;
              }) => (
                <Table.Tr key={row.timing_point_id}>
                  <Table.Td>{row.name}</Table.Td>
                  {loaderData.dates.flatMap((d: string) => {
                    const events = row.byDate[d] || [];
                    if (events.length === 0)
                      return [
                        <Table.Td
                          key={`${row.timing_point_id}-${d}-a`}
                        ></Table.Td>,
                        <Table.Td
                          key={`${row.timing_point_id}-${d}-d`}
                        ></Table.Td>,
                      ];
                    if (events.length === 1 && events[0].type === "passage") {
                      return [
                        <Table.Td key={`${row.timing_point_id}-${d}-a`}>
                          {formatTime24(events[0].timestamp)}
                        </Table.Td>,
                        <Table.Td
                          key={`${row.timing_point_id}-${d}-d`}
                        ></Table.Td>,
                      ];
                    }
                    const arrivalEvent = events.find(
                      (e) => e.type === "arrival",
                    );
                    const departureEvent = events.find(
                      (e) => e.type === "departure",
                    );
                    if (!arrivalEvent || !departureEvent) {
                      return [
                        <Table.Td
                          key={`${row.timing_point_id}-${d}-a`}
                        ></Table.Td>,
                        <Table.Td
                          key={`${row.timing_point_id}-${d}-d`}
                        ></Table.Td>,
                      ];
                    }
                    if (
                      departureEvent.timestamp - arrivalEvent.timestamp <=
                      1000 * 120
                    ) {
                      return [
                        <Table.Td key={`${row.timing_point_id}-${d}-a`}>
                          {formatTime24(arrivalEvent.timestamp)}
                        </Table.Td>,
                        <Table.Td
                          key={`${row.timing_point_id}-${d}-d`}
                        ></Table.Td>,
                      ];
                    }
                    return [
                      <Table.Td key={`${row.timing_point_id}-${d}-a`}>
                        {formatTime24(arrivalEvent.timestamp)}
                      </Table.Td>,
                      <Table.Td key={`${row.timing_point_id}-${d}-d`}>
                        {formatTime24(departureEvent.timestamp)}
                      </Table.Td>,
                    ];
                  })}
                </Table.Tr>
              ),
            )}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
}
