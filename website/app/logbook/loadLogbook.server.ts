import type { DrizzleD1Database } from "drizzle-orm/d1";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import * as Schema from "~/database/schema.d";
import { toMillisTimestamp } from "~/utils/dateTime";
import {
  buildLogbook,
  type LogbookEntry,
  type LogbookEvent,
} from "./buildLogbook";
import { parseLogbookConfig, type LogbookConfig } from "./config";

/**
 * Loading a device's logbook for one UTC day.
 *
 * Shared by the logbook page and the print route the nightly PDF is rendered from, so the
 * emailed log and the one on screen are built from exactly the same query and the same
 * entry builder.
 */

export type LoadedLogbook = {
  deviceName: string;
  entries: LogbookEntry[];
  config: LogbookConfig;
  eventCount: number;
};

/**
 * Read the device's config, tolerating a row that no longer matches the schema.
 *
 * A stale or hand-edited config should degrade to the defaults and still produce a
 * logbook, rather than turning the page into an error — the admin page is where a bad
 * config gets reported.
 */
const readConfig = (raw: unknown): LogbookConfig => {
  try {
    return parseLogbookConfig(raw);
  } catch {
    return parseLogbookConfig({});
  }
};

export async function loadLogbook(
  db: DrizzleD1Database<typeof Schema>,
  args: { deviceId: number; dateString: string },
): Promise<LoadedLogbook | null> {
  const { deviceId, dateString } = args;

  const [device] = await db
    .select({
      name: Schema.Devices.name,
      logbookConfig: Schema.Devices.logbookConfig,
    })
    .from(Schema.Devices)
    .where(eq(Schema.Devices.id, deviceId))
    .limit(1);

  if (!device) return null;

  const config = readConfig(device.logbookConfig);

  // Pull out only the configured voltage readings rather than the whole `data` blob: a
  // busy day is several thousand rows, and the JSON is by far the largest column.
  const voltageColumns = Object.fromEntries(
    config.voltage.sources.map((source, index) => [
      `voltage_${index}`,
      sql<
        number | null
      >`json_extract(${Schema.Events.data}, ${source.jsonPath})`.as(
        `voltage_${index}`,
      ),
    ]),
  );

  const rows = (await db
    .select({
      id: Schema.Events.id,
      timestamp: Schema.Events.timestamp,
      latitude: Schema.Events.latitude,
      longitude: Schema.Events.longitude,
      ...voltageColumns,
    })
    .from(Schema.Events)
    .where(
      and(
        eq(Schema.Events.deviceId, deviceId),
        eq(Schema.Events.dateString, dateString),
      ),
    )
    .orderBy(asc(Schema.Events.timestamp))) as Array<
    Record<string, number | null> & {
      id: number;
      timestamp: number;
      latitude: number;
      longitude: number;
    }
  >;

  const events: LogbookEvent[] = rows.map((row) => ({
    id: row.id,
    // Some legacy rows were written in seconds or microseconds; normalise before any
    // duration is measured against them.
    timestamp: toMillisTimestamp(row.timestamp),
    latitude: row.latitude,
    longitude: row.longitude,
    voltages: Object.fromEntries(
      config.voltage.sources.map((source, index) => [
        source.jsonPath,
        row[`voltage_${index}`] ?? null,
      ]),
    ),
  }));

  const timingPoints = await db
    .select({
      id: Schema.TimingPoints.id,
      name: Schema.TimingPoints.name,
      latitude: Schema.TimingPoints.latitude,
      longitude: Schema.TimingPoints.longitude,
      radius: Schema.TimingPoints.radius,
    })
    .from(Schema.TimingPoints)
    .where(eq(Schema.TimingPoints.deviceId, deviceId));

  return {
    deviceName: device.name,
    entries: buildLogbook({ events, timingPoints, config }),
    config,
    eventCount: events.length,
  };
}

/**
 * The nearest days either side of `dateString` that this device actually has data for.
 *
 * Skips barren days rather than stepping one calendar day at a time, so paging back
 * through a season of sailing does not mean clicking through the weeks in between. Both
 * queries are served by the leading columns of `device_dateString_timestamp_idx`.
 */
export async function findAdjacentDaysWithData(
  db: DrizzleD1Database<typeof Schema>,
  args: { deviceId: number; dateString: string; allowedDates: string[] | null },
): Promise<{ previousDate: string | null; nextDate: string | null }> {
  const { deviceId, dateString, allowedDates } = args;

  const [previous] = await db
    .select({ dateString: Schema.Events.dateString })
    .from(Schema.Events)
    .where(
      and(
        eq(Schema.Events.deviceId, deviceId),
        lt(Schema.Events.dateString, dateString),
      ),
    )
    .orderBy(desc(Schema.Events.dateString))
    .limit(1);

  const [next] = await db
    .select({ dateString: Schema.Events.dateString })
    .from(Schema.Events)
    .where(
      and(
        eq(Schema.Events.deviceId, deviceId),
        gt(Schema.Events.dateString, dateString),
      ),
    )
    .orderBy(asc(Schema.Events.dateString))
    .limit(1);

  // A date-restricted password must not be able to navigate out of its window.
  const permit = (day: string | undefined) =>
    day && (allowedDates === null || allowedDates.includes(day)) ? day : null;

  return {
    previousDate: permit(previous?.dateString),
    nextDate: permit(next?.dateString),
  };
}
