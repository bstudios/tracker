import { getDb } from "~/routeContext";
import { data, redirect } from "react-router";
import { z as zod } from "zod";
import { Events } from "~/database/schema/Events";
import type { Route } from "./+types/flespiUpload";

const rawMessageSchema = zod.record(zod.string(), zod.unknown());

const normalizedMessageSchema = zod.object({
  timestamp: zod.coerce.number().positive(),
  latitude: zod.coerce.number().min(-90).max(90),
  longitude: zod.coerce.number().min(-180).max(180),
  altitude: zod.coerce.number().optional(),
  speed: zod.coerce.number().min(0).optional(),
  heading: zod.coerce.number().min(0).max(360).optional(),
  accuracy: zod.coerce.number().min(0).optional(),
  batteryPercentage: zod.coerce.number().min(0).max(100).optional(),
  batteryCharging: zod.coerce.boolean().optional(),
});

const INSERT_CHUNK_SIZE = 200;

const getValueForKey = (source: Record<string, unknown>, key: string) => {
  if (key in source) return source[key];

  const segments = key.split(".");
  let value: unknown = source;
  for (const segment of segments) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    if (!(segment in record)) return undefined;
    value = record[segment];
  }
  return value;
};

const pickFirstValue = (source: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = getValueForKey(source, key);
    if (value !== undefined) return value;
  }
  return undefined;
};

const toMessages = (payload: unknown) => {
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object" || payload === null) return [payload];

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.result)) return record.result;
  if (Array.isArray(record.messages)) return record.messages;
  if (Array.isArray(record.data)) return record.data;
  return [payload];
};

export const loader = async ({}: Route.LoaderArgs) => redirect("/");

export const action = async ({ context, request }: Route.ActionArgs) => {
  if (request.method !== "POST") {
    return data({ message: "Method not allowed" }, 405);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return data({ message: "Invalid JSON" }, 400);
  }

  const messages = toMessages(payload);
  if (messages.length === 0) {
    return data({ message: "No messages provided" }, 400);
  }

  const eventValues: Array<{
    timestamp: number;
    data: {
      location: {
        accuracy: number;
        longitude: number;
        altitude: number;
        heading: number;
        latitude: number;
        speed: number;
        altitudeAccuracy: null;
      };
      battery: { percentage: number; charging: boolean } | null;
    };
  }> = [];

  for (const [index, message] of messages.entries()) {
    const parsedMessage = rawMessageSchema.safeParse(message);
    if (!parsedMessage.success) {
      return data({ message: `Invalid message at index ${index}` }, 400);
    }

    const normalized = normalizedMessageSchema.safeParse({
      timestamp: pickFirstValue(parsedMessage.data, [
        "timestamp",
        "timestamp.unix",
        "position.timestamp",
      ]),
      latitude: pickFirstValue(parsedMessage.data, [
        "position.latitude",
        "latitude",
        "lat",
      ]),
      longitude: pickFirstValue(parsedMessage.data, [
        "position.longitude",
        "longitude",
        "lon",
      ]),
      altitude: pickFirstValue(parsedMessage.data, [
        "position.altitude",
        "altitude",
      ]),
      speed: pickFirstValue(parsedMessage.data, ["position.speed", "speed"]),
      heading: pickFirstValue(parsedMessage.data, [
        "position.direction",
        "heading",
        "course",
      ]),
      accuracy: pickFirstValue(parsedMessage.data, [
        "position.accuracy",
        "accuracy",
        "position.hdop",
        "hdop",
      ]),
      batteryPercentage: pickFirstValue(parsedMessage.data, [
        "battery.level",
        "battery.percentage",
      ]),
      batteryCharging: pickFirstValue(parsedMessage.data, [
        "battery.charging",
        "battery.is_charging",
      ]),
    });

    if (!normalized.success) {
      return data(
        {
          message: `Invalid message fields at index ${index}`,
          error: normalized.error,
        },
        400,
      );
    }

    const timestampMs =
      normalized.data.timestamp < 1_000_000_000_000
        ? normalized.data.timestamp * 1000
        : normalized.data.timestamp;

    eventValues.push({
      timestamp: timestampMs,
      data: {
        location: {
          accuracy: normalized.data.accuracy ?? 0,
          longitude: normalized.data.longitude,
          altitude: normalized.data.altitude ?? 0,
          heading: normalized.data.heading ?? 0,
          latitude: normalized.data.latitude,
          speed: normalized.data.speed ?? 0,
          altitudeAccuracy: null,
        },
        battery:
          normalized.data.batteryPercentage !== undefined &&
          normalized.data.batteryCharging !== undefined
            ? {
                percentage: normalized.data.batteryPercentage,
                charging: normalized.data.batteryCharging,
              }
            : null,
      },
    });
  }

  for (let i = 0; i < eventValues.length; i += INSERT_CHUNK_SIZE) {
    const chunk = eventValues.slice(i, i + INSERT_CHUNK_SIZE);
    const insertTimeSeries = await getDb(context).insert(Events).values(chunk);
    if (insertTimeSeries.error) {
      return data(
        {
          message: insertTimeSeries.error,
          chunkStartIndex: i,
        },
        500,
      );
    }
  }

  return data({ inserted: eventValues.length }, 200);
};
