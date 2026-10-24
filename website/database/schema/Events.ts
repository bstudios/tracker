import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { Devices } from "./Devices";

export type JsonValue =
  string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

export const Events = sqliteTable(
  "events",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    timestamp: integer("timestamp", { mode: "number" }).notNull(),
    dateString: text("date_string").notNull(), // YYYY-MM-DD a representation of the date in UTC to speed up queries for a specific day (see index below)
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    h3Index: text("h3_index").notNull(),
    // The fix's cell at `TIMING_POINT_H3_RESOLUTION`, so matching an event to a timing point
    // is an equality join on `timing_point_cells` rather than a distance calculation.
    h3Cell: text("h3_cell").notNull().default(""),
    data: text("data", { mode: "json" })
      .$type<{
        location: {
          accuracy: number;
          longitude: number;
          altitude: number;
          heading: number;
          latitude: number;
          altitudeAccuracy: number | null;
          speed: number;
        };
        battery: {
          percentage: number;
          charging: boolean;
          voltage: number;
        } | null;
        other?: Record<string, JsonValue>;
      }>()
      .notNull(),
    deviceId: integer("device_id", { mode: "number" })
      .notNull()
      .references(() => Devices.id),
  },
  (table) => [
    index("h3_idx").on(table.h3Index),
    index("device_dateString_h3_idx").on(
      table.deviceId,
      table.dateString,
      table.h3Index,
    ),
    index("device_h3Cell_dateString_idx").on(
      table.deviceId,
      table.h3Cell,
      table.dateString,
    ),
    index("device_dateString_timestamp_idx").on(
      table.deviceId,
      table.dateString,
      table.timestamp,
    ),
  ],
);
