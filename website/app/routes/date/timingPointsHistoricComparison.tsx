import { getDb, getPasswordRouteAccess } from "~/routeContext";
import { Container, Table, Text, Title } from "@mantine/core";
import { asc, eq, sql } from "drizzle-orm";
import printClasses from "~/components/Print.module.css";
import * as Schema from "~/database/schema.d";
import {
  normaliseBadges,
  TimingPointLabel,
  type TimingPointLabelProps,
} from "~/components/TimingPointLabel";
import { formatTime24 } from "~/utils/dateTime";
import {
  buildTimingPointMatchCtes,
  parseTimingPointEvents,
  type TimingPointEvent,
} from "~/utils/timingPointMatches";
import { timingPointLatLng } from "~/utils/timingPointShape";
import type { Route } from "./+types/timingPointsHistoricComparison";

const pageTitle = (loaderData: { deviceName: string; date: string }) =>
  `${loaderData.deviceName} – Timing point comparison`;

export const meta = ({ loaderData }: Route.MetaArgs) => {
  return [{ title: loaderData ? pageTitle(loaderData) : "Timing Points" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(context);

  const { urlDate, password, deviceId } = getPasswordRouteAccess(context);

  const [device] = await db
    .select({ name: Schema.Devices.name })
    .from(Schema.Devices)
    .where(eq(Schema.Devices.id, deviceId))
    .limit(1);

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
      sql`${rankedEvents.timing_point_id}`,
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
      icon: selectedTimingPoints.icon,
      googleLink: selectedTimingPoints.googleLink,
      anchorCell: selectedTimingPoints.anchorCell,
      badges: selectedTimingPoints.badges,
      description: selectedTimingPoints.description,
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
      label: TimingPointLabelProps | null;
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
        label: null,
        byDate: {},
      };
    }
    grouped[row.timing_point_id].byDate[row.date] = events;
  }

  // Ensure timing points with no events are included
  // and carry everything the location column shows for each one.
  for (const tp of deviceTimingPoints as {
    id: number;
    name: string;
    order: number;
    icon: string | null;
    googleLink: string | null;
    anchorCell: string;
    badges: unknown;
    description: string | null;
  }[]) {
    if (!grouped[tp.id]) {
      grouped[tp.id] = {
        name: tp.name,
        order: tp.order,
        label: null,
        byDate: {},
      };
    }
    grouped[tp.id].label = {
      name: tp.name,
      icon: tp.icon,
      googleLink: tp.googleLink,
      ...timingPointLatLng(tp.anchorCell),
      badges: normaliseBadges(tp.badges),
      description: tp.description,
    };
  }

  const rows = Object.entries(grouped)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([tpId, info]) => ({
      timing_point_id: Number(tpId),
      name: info.name,
      order: info.order,
      label: info.label,
      byDate: info.byDate,
    }));

  return {
    dates,
    rows: rows as {
      timing_point_id: number;
      name: string;
      order: number;
      label: TimingPointLabelProps | null;
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
    deviceName: device?.name ?? "",
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <Container fluid p={"md"}>
      <Title order={2} mb="md" className={printClasses.printOnly}>
        {pageTitle(loaderData)}
      </Title>
      {loaderData.rows.length === 0 ? (
        <Title>No data available</Title>
      ) : (
        <Table
          striped
          highlightOnHover
          stickyHeader
          stickyHeaderOffset={0}
          className={printClasses.printTable}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Location</Table.Th>
              {loaderData.dates.map((d: string) => (
                <Table.Th key={d}>{d}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loaderData.rows.map(
              (row: {
                timing_point_id: number;
                name: string;
                label: TimingPointLabelProps | null;
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
                  <Table.Td>
                    {row.label ? <TimingPointLabel {...row.label} /> : row.name}
                  </Table.Td>
                  {loaderData.dates.map((d: string) => {
                    const events = row.byDate[d] || [];
                    const cellKey = `${row.timing_point_id}-${d}`;
                    if (events.length === 1 && events[0].type === "passage") {
                      return (
                        <Table.Td key={cellKey}>
                          {formatTime24(events[0].timestamp)}
                        </Table.Td>
                      );
                    }
                    const arrivalEvent = events.find(
                      (e) => e.type === "arrival",
                    );
                    const departureEvent = events.find(
                      (e) => e.type === "departure",
                    );
                    if (!arrivalEvent || !departureEvent) {
                      return <Table.Td key={cellKey}></Table.Td>;
                    }
                    // Stops of two minutes or less are effectively a passage.
                    const showDeparture =
                      departureEvent.timestamp - arrivalEvent.timestamp >
                      1000 * 120;
                    return (
                      <Table.Td key={cellKey}>
                        {formatTime24(arrivalEvent.timestamp)}
                        {showDeparture && (
                          <Text span c="dimmed" ml={4}>
                            (departed {formatTime24(departureEvent.timestamp)})
                          </Text>
                        )}
                      </Table.Td>
                    );
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
