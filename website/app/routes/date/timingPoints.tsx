import { getDb, getPasswordRouteAccess } from "~/routeContext";
import { Anchor, Container, Group, Table, Title } from "@mantine/core";
import { IconCoffee, IconGasStation, IconTrain } from "@tabler/icons-react";
import { asc, eq, sql } from "drizzle-orm";
import { Link, type MetaFunction } from "react-router";
import { formatDurationBetween, formatTime24 } from "~/utils/dateTime";
import {
  buildTimingPointMatchCtes,
  parseTimingPointEvents,
} from "~/utils/timingPointMatches";
import type { Route } from "./+types/timingPoints";

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
    dateString: urlDate,
    partitionByDate: false,
  });

  const aggregatedEvents = db.$with("aggregated_events").as(
    db
      .select({
        timing_point_id: rankedEvents.timing_point_id,
        events: aggregatedEventsSql.as("events"),
      })
      .from(rankedEvents)
      .where(arrivalOrDepartureOnly)
      .groupBy(rankedEvents.timing_point_id),
  );

  // Return all of the device's timing points, including those nothing matched today, so
  // the table still lists the ones the device has not reached yet.
  const timingPointsWithEvents = await db
    .with(...ctes, aggregatedEvents)
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
              const events = parseTimingPointEvents(timingPoint.events);
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
                      {formatTime24(events[0].timestamp)}
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
                              {formatTime24(arrivalEvent.timestamp)}
                            </Table.Td>
                          ); // If the difference between the arrival and departure times is less than 2 minutes, then just show the arrival time
                        return (
                          <>
                            <Table.Td>
                              {formatTime24(arrivalEvent.timestamp)}
                            </Table.Td>
                            <Table.Td>
                              {formatTime24(departureEvent.timestamp)} (
                              {formatDurationBetween(
                                arrivalEvent.timestamp,
                                departureEvent.timestamp,
                              )}
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
