import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import * as Schema from "~/database/schema.d";

/**
 * Every `YYYY-MM-DD` date a device has events for, newest first.
 *
 * A plain `GROUP BY date_string` walks every index entry the device has ever written, so
 * it gets slower with each day of tracking. This hops from one distinct date to the next
 * instead: each step is a single `max()` seek on `device_dateString_timestamp_idx`, so it
 * reads roughly one row per date regardless of how many events each day holds.
 */
export async function getAvailableDates(
  db: DrizzleD1Database<typeof Schema>,
  deviceId: number,
): Promise<string[]> {
  const rows = await db.all<{ date_string: string }>(sql`
    WITH RECURSIVE dates(date_string) AS (
      SELECT max(${Schema.Events.dateString})
      FROM ${Schema.Events}
      WHERE ${Schema.Events.deviceId} = ${deviceId}
      UNION ALL
      SELECT (
        SELECT max(${Schema.Events.dateString})
        FROM ${Schema.Events}
        WHERE ${Schema.Events.deviceId} = ${deviceId}
          AND ${Schema.Events.dateString} < dates.date_string
      )
      FROM dates
      WHERE dates.date_string IS NOT NULL
    )
    SELECT date_string FROM dates WHERE date_string IS NOT NULL
  `);

  return rows.map((row) => row.date_string);
}
