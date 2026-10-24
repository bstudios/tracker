import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { Devices } from "./Devices";
/**
 * Timing points are places that are used to track the progress of a device through a course. They can be used to track the progress of a device through a race, or to track the progress of a device through a course for other purposes.
 * They can be thought of as waypoints for a course.
 * A timing point's extent is a set of H3 cells (`timing_point_cells`), so it can be any shape.
 * Each timing point belongs to exactly one device - the dates a timing point applies to are derived from the dates that device actually has matching events on.
 */
export const TimingPoints = sqliteTable(
  "timing_points",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name", { mode: "text" }).notNull(),
    deviceId: integer("device_id", { mode: "number" })
      .notNull()
      .references(() => Devices.id),
    order: integer("order", { mode: "number" }).default(99999).notNull(),
    // A cell inside the point's shape (see `timing_point_cells`), used wherever the point
    // needs a single position: its marker, map links, coordinates in the logbook. See
    // `timingPointLatLng`.
    anchorCell: text("anchor_cell").notNull().default(""),
    icon: text("icon", { mode: "text" }).default(sql`NULL`),
    googleLink: text("google_link", { mode: "text" }).default(sql`NULL`),
    group: text("group", { mode: "text" }).default("Other Timing Points"),
    // Short labels shown next to the name, e.g. "Blue route".
    badges: text("badges", { mode: "json" })
      .$type<string[]>()
      .default(sql`'[]'`)
      .notNull(),
    // Free text shown beneath the name.
    description: text("description", { mode: "text" }).default(sql`NULL`),
  },
  (table) => [index("timing_points_device_idx").on(table.deviceId)],
);
