import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { data } from "react-router";
import { z as zod } from "zod";
import { Events } from "~/database/schema/Events";
import { getDb } from "~/routeContext";
import { getH3IndexForLocation, toUtcDateString } from "~/utils/h3";
import type { Route } from "./+types/backfillH3";

const payloadSchema = zod.object({
  batchSize: zod.coerce.number().int().min(1).max(100).default(100),
  maxBatches: zod.coerce.number().int().min(1).max(200).default(20),
});

const requestParamsSchema = zod.object({
  batchSize: zod.coerce.number().int().min(1).max(100).optional(),
  maxBatches: zod.coerce.number().int().min(1).max(200).optional(),
});

const parseCoordsFromData = (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const dataObject = value as Record<string, unknown>;
  const location = dataObject.location;
  if (
    typeof location !== "object" ||
    location === null ||
    Array.isArray(location)
  ) {
    return null;
  }

  const locationObject = location as Record<string, unknown>;
  const latitude = Number(locationObject.latitude);
  const longitude = Number(locationObject.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
};

const isLocalRequest = (request: Request) => {
  const url = new URL(request.url);
  return ["localhost", "127.0.0.1"].includes(url.hostname);
};

const runBackfill = async (
  context: Route.ActionArgs["context"] | Route.LoaderArgs["context"],
  options: { batchSize: number; maxBatches: number },
) => {
  const db = getDb(context);
  const { batchSize, maxBatches } = options;

  let totalUpdated = 0;
  let totalSkipped = 0;
  let batchesProcessed = 0;
  let lastSeenId = 0;

  while (batchesProcessed < maxBatches) {
    const batch = await db
      .select({
        id: Events.id,
        timestamp: Events.timestamp,
        h3Index: Events.h3Index,
        data: Events.data,
      })
      .from(Events)
      .where(
        and(
          gt(Events.id, lastSeenId),
          or(isNull(Events.h3Index), eq(Events.h3Index, "")),
        ),
      )
      .orderBy(asc(Events.id))
      .limit(batchSize);

    if (batch.length === 0) {
      break;
    }

    for (const row of batch) {
      lastSeenId = row.id;
      const coords = parseCoordsFromData(row.data);
      if (!coords) {
        totalSkipped += 1;
        continue;
      }

      await db
        .update(Events)
        .set({
          latitude: coords.latitude,
          longitude: coords.longitude,
          h3Index: getH3IndexForLocation(coords.latitude, coords.longitude),
          dateString: toUtcDateString(row.timestamp),
        })
        .where(eq(Events.id, row.id));

      totalUpdated += 1;
    }

    batchesProcessed += 1;
  }

  return {
    updated: totalUpdated,
    skipped: totalSkipped,
    batchesProcessed,
    batchSize,
    maxBatches,
    done: batchesProcessed < maxBatches,
  };
};

export const action = async ({ context, request }: Route.ActionArgs) => {
  if (request.method !== "POST") {
    return data({ message: "Method not allowed" }, 405);
  }

  if (!isLocalRequest(request)) {
    return data({ message: "This endpoint is for local backfills only." }, 403);
  }

  let payload: unknown = {};
  try {
    if (request.headers.get("content-length") !== "0") {
      payload = await request.json();
    }
  } catch {
    return data({ message: "Invalid JSON" }, 400);
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return data({ message: parsed.error.message }, 400);
  }

  return data(await runBackfill(context, parsed.data), 200);
};

export const loader = async ({ context, request }: Route.LoaderArgs) => {
  if (!isLocalRequest(request)) {
    return data({ message: "This endpoint is for local backfills only." }, 403);
  }

  const url = new URL(request.url);
  const parsedParams = requestParamsSchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedParams.success) {
    return data({ message: parsedParams.error.message }, 400);
  }

  const parsedPayload = payloadSchema.parse(parsedParams.data);
  return data(await runBackfill(context, parsedPayload), 200);
};
