import { getDb, getPasswordRouteAccess } from "~/routeContext";
import { Center, Stack, Title } from "@mantine/core";
import { and, desc, gte, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { Link, type MetaFunction } from "react-router";
import { LiveMap } from "~/components/LiveMap/LiveMap";
import * as Schema from "~/database/schema.d";
import type { Route } from "./+types/map";

export const meta: MetaFunction = () => {
  return [{ title: "Tracking" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const { refDate, urlDate, password } = getPasswordRouteAccess(context);

  const events = await getDb(context)
    .select({
      timestamp: Schema.Events.timestamp,
      data: Schema.Events.data,
    })
    .from(Schema.Events)
    .orderBy(desc(Schema.Events.timestamp))
    .where(
      and(
        gte(Schema.Events.timestamp, refDate.toMillis()),
        lte(Schema.Events.timestamp, refDate.toMillis() + 86400000), // 24 hours
      ),
    );

  const timingPoints = await getDb(context)
    .select({
      name: Schema.TimingPoints.name,
      latitude: Schema.TimingPoints.latitude,
      longitude: Schema.TimingPoints.longitude,
      group: Schema.TimingPoints.group,
      icon: Schema.TimingPoints.icon,
      googleLink: Schema.TimingPoints.googleLink,
    })
    .from(Schema.TimingPoints).where(sql`EXISTS (
      SELECT 1
      FROM json_each(${Schema.TimingPoints.applicableDates})
      WHERE value = ${urlDate}
    )`); // Selects only timing points that are applicable for the current date
  // No point having an order by given that it's a map

  return {
    date: refDate.toISO(),
    events,
    urlDate,
    timingPoints,
    password,
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  if (loaderData.events.length === 0) {
    return (
      <Center>
        <Stack>
          <Title order={1} py="xl" px="xl">
            No data received for{" "}
            {loaderData.date
              ? DateTime.fromISO(loaderData.date).toFormat("yyyy-MM-dd")
              : undefined}{" "}
            yet
          </Title>
        </Stack>
      </Center>
    );
  }
  return (
    <>
      <LiveMap
        zoom={13}
        pins={loaderData.events
          .filter(
            (event) =>
              "latitude" in event.data.location &&
              "longitude" in event.data.location,
          )
          .map((event) => ({
            latitude: event.data.location.latitude,
            longitude: event.data.location.longitude,
            timestamp: event.timestamp,
          }))}
        timingPoints={loaderData.timingPoints}
        urlDate={loaderData.urlDate}
        password={loaderData.password}
      />
      <Link
        to={`/${loaderData.password}/${loaderData.urlDate}/analysis`}
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          zIndex: 2000,
        }}
      >
        <Title
          order={4}
          c="pink"
          style={{
            background: "rgba(255,255,255,0.85)",
            padding: "8px 12px",
            borderRadius: 999,
          }}
        >
          Analysis
        </Title>
      </Link>
    </>
  );
}
