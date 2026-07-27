import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Devices } from "./Devices";

/**
 * Free-text notes a viewer or admin has added to a device's logbook, e.g. "reefed main,
 * wind picking up" — something worth recording that isn't derivable from position reports.
 *
 * `dateString` is set from whichever day the remark was added *for*, not derived from
 * `timestamp`: a remark timed near midnight should stay on the day its author was looking
 * at rather than jumping to whichever UTC day that instant happens to fall in, which is the
 * only reason this doesn't just reuse `toUtcDateString` the way `events` does.
 */
export const LogbookRemarks = sqliteTable(
  "logbook_remarks",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    deviceId: integer("device_id", { mode: "number" })
      .notNull()
      .references(() => Devices.id),
    dateString: text("date_string").notNull(),
    // Unix milliseconds — when the remark applies to, not when it was written.
    timestamp: integer("timestamp", { mode: "number" }).notNull(),
    text: text("text", { mode: "text" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("logbook_remarks_device_dateString_idx").on(
      table.deviceId,
      table.dateString,
    ),
  ],
);
