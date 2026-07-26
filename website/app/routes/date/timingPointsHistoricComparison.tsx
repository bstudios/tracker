import { getDb, getPasswordRouteAccess } from "~/routeContext";
import { Container, Table, Title } from "@mantine/core";
import { asc, sql } from "drizzle-orm";
import { type MetaFunction } from "react-router";
import { formatTime24 } from "~/utils/dateTime";
import {
  buildTimingPointMatchCtes,
  parseTimingPointEvents,
  type TimingPointEvent,
} from "~/utils/timingPointMatches";
import type { Route } from "./+types/timingPointsHistoricComparison";

export const meta: MetaFunction = () => {
  return [{ title: "Timing Points" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(context);

  const { urlDate, password, deviceId } = getPasswordRouteAccess(context);

  const {
    ctes,
    selectedTimingPoints,
    rankedEvents,
    aggregatedEventsSql,
    arrivalOrDepartureOnly,
  } = buildTimingPointMatchCtes(db, {
    deviceId,
    // No date filter: timing points are no longer pinned to dates, so the dates we compare
    // against are simply whichever dates this device actually has matches on.
    partitionByDate: true,
  });

  // One row per timing point per date, carrying that date's arrival/departure.
  const timingPointsByDate = await db
    .with(...ctes)
    .select({
      timing_point_id: rankedEvents.timing_point_id,
      name: rankedEvents.name,
      order: rankedEvents.order,
      date: rankedEvents.date,
      events: aggregatedEventsSql.as("events"),
    })
    .from(rankedEvents)
    .where(arrivalOrDepartureOnly)
    .groupBy(
      rankedEvents.timing_point_id,
      rankedEvents.name,
      rankedEvents.order,
      sql`${rankedEvents.date}`,
    )
    .orderBy(asc(rankedEvents.order), asc(rankedEvents.date));

  // Also fetch all of the device's timing points (even if they have no events)
  const deviceTimingPoints = await db
    .with(...ctes)
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
      byDate: Record<string, TimingPointEvent[]>;
    }
  > = {};

  for (const row of timingPointsByDate as {
    timing_point_id: number;
    name: string;
    order: number;
    date: string;
    events: string;
  }[]) {
    const events = parseTimingPointEvents(row.events);
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
