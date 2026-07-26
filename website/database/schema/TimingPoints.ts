import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { Devices } from "./Devices";
/**
 * Timing points are locations that are used to track the progress of a device through a course. They can be used to track the progress of a device through a race, or to track the progress of a device through a course for other purposes.
 * They can be thought of as waypoints for a course.
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
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    h3Index: text("h3_index").notNull().default(""),
    radius: integer("radius", { mode: "number" }).default(10).notNull(), // Metres
    icon: text("icon", { mode: "text" }).default(sql`NULL`),
    googleLink: text("google_link", { mode: "text" }).default(sql`NULL`),
    group: text("group", { mode: "text" }).default("Other Timing Points"),
  },
  (table) => [index("timing_points_device_idx").on(table.deviceId)],
);
