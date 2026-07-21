import { getDb } from "~/routeContext";
import { data } from "react-router";
import { z as zod } from "zod";
import { Events } from "~/database/schema/Events";
import type { Route } from "./+types/traccarUpload";
import { getH3IndexForLocation, toUtcDateString } from "~/utils/h3";

export const loader = async ({ context, request }: Route.LoaderArgs) => {
  const getRequestParameters = zod.object({
    name: zod.string().optional(),
    uniqueId: zod.string().optional(),
    status: zod.string().optional(),
    deviceId: zod.coerce.number().optional(),
    protocol: zod.string().optional(),
    deviceTime: zod.coerce.number(), // milliseconds since epoch
    fixTime: zod.coerce.number(), // milliseconds since epoch
    valid: zod.coerce.boolean().optional(),
    latitude: zod.coerce.number().max(90).min(-90),
    longitude: zod.coerce.number().max(180).min(-180),
    altitude: zod.coerce.number().optional(),
    speed: zod.coerce.number().min(0).optional(),
    course: zod.coerce.number().min(0).max(360).optional(),
    accuracy: zod.coerce.number().optional(),
    statusCode: zod.string().optional(),
    address: zod.string().optional(),
    attributes: zod.string().optional(),
    gprmc: zod.string().optional(),
  });
  // Get parameters from the request
  const url = new URL(request.url);
  console.log(
    `Request received, method ${
      request.method
    }, parameters ${url.searchParams.toString()}, body ${await request.text()}`,
  );
  const parsedRequestParameters = await getRequestParameters.safeParseAsync(
    Object.fromEntries(url.searchParams),
  );
  if (parsedRequestParameters.success) {
    const latitude = parsedRequestParameters.data.latitude;
    const longitude = parsedRequestParameters.data.longitude;
    const timestamp = parsedRequestParameters.data.fixTime;

    const insertTimeSeries = await getDb(context)
      .insert(Events)
      .values({
        timestamp,
        dateString: toUtcDateString(timestamp),
        latitude,
        longitude,
        h3Index: getH3IndexForLocation(latitude, longitude),
        deviceId: 1, // TODO: This should be the device ID that is associated with the API key that was used to authenticate this request.
        data: {
          location: {
            accuracy: parsedRequestParameters.data.accuracy ?? 0,
            longitude,
            altitude: parsedRequestParameters.data.altitude ?? 0,
            heading: parsedRequestParameters.data.course ?? 0,
            latitude,
            speed: parsedRequestParameters.data.speed ?? 0,
            altitudeAccuracy: null,
          },
          battery: null,
        },
      });
    if (insertTimeSeries.error)
      return data({ message: insertTimeSeries.error }, 500);
    return data({}, 200);
  } else {
    console.log(
      `Errors from zod: ${JSON.stringify(parsedRequestParameters.error)}`,
    );
    console.log(`Data: ${JSON.stringify(parsedRequestParameters.data)}`);
    return data({ message: "Invalid request" }, 400);
  }
};

export const action = async ({ context, request }: Route.ActionArgs) => {
  if (request.method === "POST") {
    const postPayloadSchema = zod.object({
      event: zod.object({
        id: zod.coerce.number(),
        attributes: zod.object({}).optional(),
        deviceId: zod.coerce.number(),
        type: zod.string(),
        eventTime: zod.string(),
        positionId: zod.coerce.number(),
        geofenceId: zod.coerce.number(),
        maintenanceId: zod.coerce.number(),
      }),
      device: zod.object({
        id: zod.coerce.number(),
        attributes: zod.object({}).optional(),
        groupId: zod.coerce.number(),
        calendarId: zod.coerce.number(),
        name: zod.string(),
        uniqueId: zod.string(),
        status: zod.string(),
        lastUpdate: zod.string(),
        positionId: zod.coerce.number(),
        phone: zod.string().optional(),
        model: zod.string().optional(),
        contact: zod.string().optional(),
        category: zod.string().optional(),
        disabled: zod.string(),
        expirationTime: zod.string().optional(),
      }),
    });
    let payload: unknown;
    try {
      payload = await request.json();
    } catch (e) {
      return data({ message: "Invalid JSON" }, 400);
    }
    const parsedPayload = await postPayloadSchema.safeParseAsync(payload);
    if (!parsedPayload.success)
      console.log(`Errors from zod: ${JSON.stringify(parsedPayload.error)}`);
    else console.log("Passed validation successfully");
    console.log(`Payload is ${JSON.stringify(payload)}`);
    return data({ message: "Not yet developed" }, 200);
  } else return data({ message: "Method not allowed" }, 405);
};
