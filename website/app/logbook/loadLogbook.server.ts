import type { DrizzleD1Database } from "drizzle-orm/d1";
import { and, asc, eq, sql } from "drizzle-orm";
import * as Schema from "~/database/schema.d";
import { toMillisTimestamp } from "~/utils/dateTime";
import {
  buildLogbook,
  sortLogbookEntries,
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
  /** True when the day had more fixes than `MAX_EVENTS_PER_DAY` and was cut short. */
  truncated: boolean;
};

/**
 * Ceiling on how many fixes one day's log is built from.
 *
 * Devices in normal use report every 20-30 seconds, so a full day is three to four
 * thousand rows and this is roughly five times the headroom needed. It exists for the
 * misconfigured case — a tracker stuck reporting every second would otherwise pull ~86,000
 * rows through a worker with a fixed memory and CPU budget. Hitting it truncates the day
 * and says so, rather than timing out or quietly lying about when the boat got in.
 */
const MAX_EVENTS_PER_DAY = 20_000;

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
  const [rows, timingPoints, voltageRuns, remarks] = await Promise.all([
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
      .orderBy(asc(Schema.Events.timestamp))
      // One over the cap, so a full page tells us the day was truncated.
      .limit(MAX_EVENTS_PER_DAY + 1),
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
    db
      .select({
        timestamp: Schema.LogbookRemarks.timestamp,
        text: Schema.LogbookRemarks.text,
      })
      .from(Schema.LogbookRemarks)
      .where(
        and(
          eq(Schema.LogbookRemarks.deviceId, deviceId),
          eq(Schema.LogbookRemarks.dateString, dateString),
        ),
      )
      .orderBy(asc(Schema.LogbookRemarks.timestamp)),
  ]);

  const truncated = rows.length > MAX_EVENTS_PER_DAY;

  const events: LogbookEvent[] = rows
    .slice(0, MAX_EVENTS_PER_DAY)
    .map((row) => ({
      // Some legacy rows were written in seconds or microseconds; normalise before any
      // duration is measured against them.
      timestamp: toMillisTimestamp(row.timestamp),
      latitude: row.latitude,
      longitude: row.longitude,
    }));

  const builtEntries = buildLogbook({
    events,
    timingPoints,
    config,
    voltageRuns: voltageRuns.map((run) => ({
      ...run,
      startTimestamp: toMillisTimestamp(run.startTimestamp),
    })),
    now: Date.now(),
  });

  // Remarks are free text against a timestamp, not derived from fixes, so they are merged
  // in here rather than inside `buildLogbook` — which stays pure and DB-free — and
  // re-sorted the same way it sorts its own entries.
  const remarkEntries: LogbookEntry[] = remarks.map((remark) => ({
    timestamp: toMillisTimestamp(remark.timestamp),
    kind: "remark",
    title: "Remark",
    detail: remark.text,
  }));

  return {
    deviceName: device.name,
    entries:
      remarkEntries.length > 0
        ? sortLogbookEntries([...builtEntries, ...remarkEntries])
        : builtEntries,
    config,
    eventCount: events.length,
    truncated,
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
