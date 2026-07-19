import { getDb } from "~/routeContext";
import { data, redirect } from "react-router";
import { z as zod } from "zod";
import { Events } from "~/database/schema/Events";
import type { Route } from "./+types/appUpload";

export const loader = async ({}: Route.LoaderArgs) => redirect("/");

const validator = zod.object({
  location: zod.object({
    coords: zod.object({
      accuracy: zod.number(),
      longitude: zod.number(),
      altitude: zod.number(),
      heading: zod.number(),
      latitude: zod.number(),
      altitudeAccuracy: zod.number(),
      speed: zod.number(),
    }),
    mocked: zod.boolean(),
    timestamp: zod.number(),
  }),
  battery: zod.object({
    percentage: zod.number(),
    charging: zod.boolean(),
  }),
});

export const action = async ({ context, request }: Route.ActionArgs) => {
  if (request.method !== "PUT") {
    return data({ message: "Method not allowed" }, 405);
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch (e) {
    return data({ message: "Invalid JSON" }, 400);
  }
  const validated = await validator.safeParseAsync(payload);
  if (!validated.success) return data({ message: validated.error }, 400);

  const insertTimeSeries = await getDb(context)
    .insert(Events)
    .values({
      timestamp: validated.data.location.timestamp,
      deviceId: 1, // TODO: This should be the device ID that is associated with the API key that was used to authenticate this request.
      data: {
        location: {
          accuracy: validated.data.location.coords.accuracy,
          longitude: validated.data.location.coords.longitude,
          altitude: validated.data.location.coords.altitude,
          heading: validated.data.location.coords.heading,
          latitude: validated.data.location.coords.latitude,
          altitudeAccuracy: validated.data.location.coords.altitudeAccuracy,
          speed: validated.data.location.coords.speed,
        },
        battery: validated.data.battery,
      },
    });
  if (insertTimeSeries.error)
    return data({ message: insertTimeSeries.error }, 500);
  return data({}, 200);
};
