import { getDb, getPasswordRouteAccess } from "~/routeContext";
import { Center, Stack, Title } from "@mantine/core";
import { and, desc, eq } from "drizzle-orm";
import { isRouteErrorResponse, Link, type MetaFunction } from "react-router";
import { LiveMap } from "~/components/LiveMap/LiveMap";
import * as Schema from "~/database/schema.d";
import { formatUtcDay } from "~/utils/dateTime";
import type { Route } from "./+types/map";

export const meta: MetaFunction = () => {
  return [{ title: "Tracking" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const { urlDate, password, deviceId } = getPasswordRouteAccess(context);

  const db = getDb(context);

  const [[device], events, timingPoints] = await db.batch([
    db
      .select({ icon: Schema.Devices.icon })
      .from(Schema.Devices)
      .where(eq(Schema.Devices.id, deviceId))
      .limit(1),
    db
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
      ),
    // Selects only the timing points belonging to this device.
    // No point having an order by given that it's a map
    db
      .select({
        name: Schema.TimingPoints.name,
        latitude: Schema.TimingPoints.latitude,
        longitude: Schema.TimingPoints.longitude,
        group: Schema.TimingPoints.group,
        icon: Schema.TimingPoints.icon,
        googleLink: Schema.TimingPoints.googleLink,
      })
      .from(Schema.TimingPoints)
      .where(eq(Schema.TimingPoints.deviceId, deviceId)),
  ]);

  return {
    events,
    urlDate,
    timingPoints,
    password,
    deviceIcon: device?.icon ?? null,
  };
}

// The last load that reached the server, so that a poll which fails can hand the map back
// what it already had rather than replacing it with the error page. Keyed by pathname so a
// different password or day never inherits another page's positions.
let lastSuccessfulLoad: {
  pathname: string;
  data: Awaited<ReturnType<typeof loader>>;
  loadedAt: number;
} | null = null;

/**
 * Whether the server answered on purpose — a redirect (the password was removed, or the
 * day is no longer allowed) or a 4xx — as opposed to the request failing on the way.
 * Those still have to reach the router; only the failures are worth papering over.
 */
const isDeliberateResponse = (error: unknown) =>
  error instanceof Response ||
  (isRouteErrorResponse(error) && error.status < 500);

/**
 * Keeps the live map up through a dropped poll.
 *
 * Event viewers are often on a congested mobile network, and the map revalidates every
 * minute. Without this, one failed revalidation would replace the map with the root error
 * boundary, and since the polling interval lives in the map it would also stop polling —
 * leaving the viewer on "Error" until they reloaded by hand. Instead the last good data is
 * returned with the time it was fetched, the map shows that it is out of date, and the
 * next poll tries again.
 *
 * `hydrate` runs this on the first render too, where `serverLoader()` returns the
 * server-rendered data without fetching, so a failure on the very first poll is covered.
 */
export async function clientLoader({
  request,
  serverLoader,
}: Route.ClientLoaderArgs) {
  const { pathname } = new URL(request.url);
  try {
    const data = await serverLoader();
    lastSuccessfulLoad = { pathname, data, loadedAt: Date.now() };
    return { ...data, staleSince: null };
  } catch (error) {
    if (
      isDeliberateResponse(error) ||
      lastSuccessfulLoad === null ||
      lastSuccessfulLoad.pathname !== pathname
    ) {
      throw error;
    }
    return {
      ...lastSuccessfulLoad.data,
      staleSince: lastSuccessfulLoad.loadedAt,
    };
  }
}
clientLoader.hydrate = true as const;

export default function Page({ loaderData }: Route.ComponentProps) {
  if (loaderData.events.length === 0) {
    return (
      <Center>
        <Stack>
          <Title order={1} py="xl" px="xl">
            No data received for {formatUtcDay(loaderData.urlDate)} yet
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
      staleSince={"staleSince" in loaderData ? loaderData.staleSince : null}
    />
  );
}
