import { getDb } from "~/routeContext";
import { data, redirect } from "react-router";
import { z as zod } from "zod";
import { Events } from "~/database/schema/Events";
import type { JsonValue } from "~/database/schema/Events";
import { Devices } from "~/database/schema/Devices";
import { eq, inArray } from "drizzle-orm";
import type { Route } from "./+types/flespiUpload";
import { getH3IndexForLocation, toUtcDateString } from "~/utils/h3";

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
  batteryVoltage: zod.coerce.number().min(0).optional(),
  identifier: zod.string().min(1),
  deviceTypeId: zod.coerce.string().min(1).optional(),
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

const deleteValueForKey = (source: Record<string, unknown>, key: string) => {
  const segments = key.split(".");
  let current: unknown = source;

  for (let i = 0; i < segments.length - 1; i += 1) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return;
    }

    const record = current as Record<string, unknown>;
    if (!(segments[i] in record)) return;
    current = record[segments[i]];
  }

  if (
    typeof current !== "object" ||
    current === null ||
    Array.isArray(current)
  ) {
    return;
  }

  const record = current as Record<string, unknown>;
  delete record[segments[segments.length - 1]];
};

const pruneEmptyObjects = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(pruneEmptyObjects);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const prunedEntries = Object.entries(record)
    .map(([key, nestedValue]) => [key, pruneEmptyObjects(nestedValue)] as const)
    .filter(([, nestedValue]) => {
      if (nestedValue === undefined) return false;
      if (typeof nestedValue !== "object" || nestedValue === null) return true;
      if (Array.isArray(nestedValue)) return true;
      return Object.keys(nestedValue).length > 0;
    });

  return Object.fromEntries(prunedEntries);
};

const knownMappedKeys = [
  "timestamp",
  "timestamp.unix",
  "position.timestamp",
  "position.latitude",
  "latitude",
  "lat",
  "position.longitude",
  "longitude",
  "lon",
  "position.altitude",
  "altitude",
  "position.speed",
  "speed",
  "position.direction",
  "heading",
  "course",
  "position.accuracy",
  "accuracy",
  "position.hdop",
  "hdop",
  "battery.level",
  "battery.percentage",
  "battery.charging",
  "battery.is_charging",
  "battery.voltage",
] as const;

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

  const db = getDb(context);

  const eventValues: Array<{
    timestamp: number;
    dateString: string;
    latitude: number;
    longitude: number;
    h3Index: string;
    deviceId: number;
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
      battery: {
        percentage: number;
        charging: boolean;
        voltage: number;
      } | null;
      other?: Record<string, JsonValue>;
    };
  }> = [];

  const identifiers = new Set<string>();
  for (const message of messages) {
    const parsedMessage = rawMessageSchema.safeParse(message);
    if (!parsedMessage.success) continue;

    const identifier = pickFirstValue(parsedMessage.data, [
      "ident",
      "device.ident",
      "device.id",
      "deviceId",
    ]);
    if (identifier !== undefined && identifier !== null) {
      identifiers.add(String(identifier));
    }
  }

  if (identifiers.size === 0) {
    return data({ message: "No device identifier provided in messages" }, 400);
  }

  const deviceRows = await db
    .select({ id: Devices.id, matchId: Devices.matchId })
    .from(Devices)
    .where(inArray(Devices.matchId, Array.from(identifiers)));

  const matchIdToDeviceId = new Map<string, number>(
    deviceRows.map((row) => [row.matchId, row.id]),
  );

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
      batteryVoltage: pickFirstValue(parsedMessage.data, ["battery.voltage"]),
      identifier: pickFirstValue(parsedMessage.data, [
        "ident",
        "device.ident",
        "device.id",
        "deviceId",
      ]),
      deviceTypeId: pickFirstValue(parsedMessage.data, [
        "device.type.id",
        "device.typeId",
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

    let deviceId = matchIdToDeviceId.get(normalized.data.identifier);
    if (deviceId === undefined) {
      const newDeviceName =
        normalized.data.deviceTypeId ?? normalized.data.identifier;

      try {
        const createdDevice = await db
          .insert(Devices)
          .values({
            name: newDeviceName,
            matchId: normalized.data.identifier,
          })
          .returning({ id: Devices.id });

        if (createdDevice.length > 0) {
          deviceId = createdDevice[0].id;
          matchIdToDeviceId.set(normalized.data.identifier, deviceId);
        }
      } catch {
        const existingDevice = await db
          .select({ id: Devices.id })
          .from(Devices)
          .where(eq(Devices.matchId, normalized.data.identifier));

        if (existingDevice.length > 0) {
          deviceId = existingDevice[0].id;
          matchIdToDeviceId.set(normalized.data.identifier, deviceId);
        }
      }

      if (deviceId === undefined) {
        return data(
          {
            message: `Failed to create or resolve device at index ${index}`,
            identifier: normalized.data.identifier,
          },
          500,
        );
      }
    }

    eventValues.push({
      timestamp: timestampMs,
      dateString: toUtcDateString(timestampMs),
      latitude: normalized.data.latitude,
      longitude: normalized.data.longitude,
      h3Index: getH3IndexForLocation(
        normalized.data.latitude,
        normalized.data.longitude,
      ),
      deviceId,
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
          normalized.data.batteryPercentage !== undefined ||
          normalized.data.batteryCharging !== undefined ||
          normalized.data.batteryVoltage !== undefined
            ? {
                percentage: normalized.data.batteryPercentage ?? 0,
                charging: normalized.data.batteryCharging ?? false,
                voltage: normalized.data.batteryVoltage ?? 0,
              }
            : null,
        other: (() => {
          const otherFields = JSON.parse(
            JSON.stringify(parsedMessage.data),
          ) as Record<string, unknown>;

          for (const key of knownMappedKeys) {
            deleteValueForKey(otherFields, key);
          }

          const pruned = pruneEmptyObjects(otherFields) as Record<
            string,
            unknown
          >;
          return Object.keys(pruned).length > 0
            ? (pruned as Record<string, JsonValue>)
            : undefined;
        })(),
      },
    });
  }

  for (let i = 0; i < eventValues.length; i += INSERT_CHUNK_SIZE) {
    const chunk = eventValues.slice(i, i + INSERT_CHUNK_SIZE);
    const insertTimeSeries = await db.insert(Events).values(chunk);
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
