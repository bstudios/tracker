import { getDb, getPasswordRouteAccess } from "~/routeContext";
import { Center, Stack, Title } from "@mantine/core";
import { and, desc, eq, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { Link, type MetaFunction } from "react-router";
import { LiveMap } from "~/components/LiveMap/LiveMap";
import * as Schema from "~/database/schema.d";
import type { Route } from "./+types/map";

export const meta: MetaFunction = () => {
  return [{ title: "Tracking" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const { refDate, urlDate, password, deviceId } =
    getPasswordRouteAccess(context);

  const [device] = await getDb(context)
    .select({ icon: Schema.Devices.icon })
    .from(Schema.Devices)
    .where(eq(Schema.Devices.id, deviceId))
    .limit(1);

  const events = await getDb(context)
    .select({
      timestamp: Schema.Events.timestamp,
      latitude: Schema.Events.latitude,
      longitude: Schema.Events.longitude,
    })
    .from(Schema.Events)
    .orderBy(desc(Schema.Events.timestamp))
    .where(
      and(
        eq(Schema.Events.deviceId, deviceId),
        eq(Schema.Events.dateString, urlDate),
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
    deviceIcon: device?.icon ?? null,
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
    <LiveMap
      zoom={13}
      pins={loaderData.events.map((event) => ({
        latitude: event.latitude,
        longitude: event.longitude,
        timestamp: event.timestamp,
      }))}
      timingPoints={loaderData.timingPoints}
      deviceIcon={loaderData.deviceIcon}
      urlDate={loaderData.urlDate}
      password={loaderData.password}
    />
  );
}
