import type { DrizzleD1Database } from "drizzle-orm/d1";
import { and, asc, eq, sql } from "drizzle-orm";
import * as Schema from "~/database/schema.d";
import { toMillisTimestamp } from "~/utils/dateTime";
import {
  buildLogbook,
  type LogbookEntry,
  type LogbookEvent,
} from "./buildLogbook";
import { parseLogbookConfig, type LogbookConfig } from "./config";
import { loadVoltageRuns } from "./voltageRuns.server";

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

  // Only the three columns the stationary pass actually needs. The `data` JSON is by far
  // the widest column and none of it is wanted here — voltage is handled separately, and
  // entirely in SQL.
  const [rows, timingPoints, voltageRuns] = await Promise.all([
    db
      .select({
        timestamp: Schema.Events.timestamp,
        latitude: Schema.Events.latitude,
        longitude: Schema.Events.longitude,
      })
      .from(Schema.Events)
      .where(
        and(
          eq(Schema.Events.deviceId, deviceId),
          eq(Schema.Events.dateString, dateString),
        ),
      )
      .orderBy(asc(Schema.Events.timestamp)),
    db
      .select({
        id: Schema.TimingPoints.id,
        name: Schema.TimingPoints.name,
        latitude: Schema.TimingPoints.latitude,
        longitude: Schema.TimingPoints.longitude,
        radius: Schema.TimingPoints.radius,
      })
      .from(Schema.TimingPoints)
      .where(eq(Schema.TimingPoints.deviceId, deviceId)),
    loadVoltageRuns(db, {
      deviceId,
      dateString,
      sources: config.voltage.sources,
    }),
  ]);

  const events: LogbookEvent[] = rows.map((row) => ({
    // Some legacy rows were written in seconds or microseconds; normalise before any
    // duration is measured against them.
    timestamp: toMillisTimestamp(row.timestamp),
    latitude: row.latitude,
    longitude: row.longitude,
  }));

  return {
    deviceName: device.name,
    entries: buildLogbook({
      events,
      timingPoints,
      config,
      voltageRuns: voltageRuns.map((run) => ({
        ...run,
        startTimestamp: toMillisTimestamp(run.startTimestamp),
      })),
    }),
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

  // One statement rather than two so this costs a single D1 round trip. Each branch is an
  // index seek to a single row, not a scan.
  const rows = await db.all<{ direction: string; date_string: string }>(sql`
    SELECT 'previous' AS direction, date_string FROM (
      SELECT ${Schema.Events.dateString} AS date_string
      FROM ${Schema.Events}
      WHERE ${Schema.Events.deviceId} = ${deviceId}
        AND ${Schema.Events.dateString} < ${dateString}
      ORDER BY ${Schema.Events.dateString} DESC
      LIMIT 1
    )
    UNION ALL
    SELECT 'next' AS direction, date_string FROM (
      SELECT ${Schema.Events.dateString} AS date_string
      FROM ${Schema.Events}
      WHERE ${Schema.Events.deviceId} = ${deviceId}
        AND ${Schema.Events.dateString} > ${dateString}
      ORDER BY ${Schema.Events.dateString} ASC
      LIMIT 1
    )
  `);

  // A date-restricted password must not be able to navigate out of its window.
  const permit = (day: string | undefined) =>
    day && (allowedDates === null || allowedDates.includes(day)) ? day : null;

  const find = (direction: string) =>
    rows.find((row) => row.direction === direction)?.date_string;

  return {
    previousDate: permit(find("previous")),
    nextDate: permit(find("next")),
  };
}
