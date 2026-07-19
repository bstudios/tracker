import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
/**
 * Timing points are locations that are used to track the progress of a device through a course. They can be used to track the progress of a device through a race, or to track the progress of a device through a course for other purposes.
 * They can be thought of as waypoints for a course.
 */
export const TimingPoints = sqliteTable("timing_points", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name", { mode: "text" }).notNull(),
  applicableDates: text("applicable_dates", { mode: "json" })
    .$type<string[]>()
    .default([]),
  order: integer("order", { mode: "number" }).default(99999).notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  radius: integer("radius", { mode: "number" }).default(10).notNull(), // Metres
  icon: text("icon", { mode: "text" }).default(sql`NULL`),
  googleLink: text("google_link", { mode: "text" }).default(sql`NULL`),
  group: text("group", { mode: "text" }).default("Other Timing Points"),
});
