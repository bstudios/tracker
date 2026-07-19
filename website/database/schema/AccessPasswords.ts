import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Devices } from "./Devices";

export const AccessPasswords = sqliteTable("access_passwords", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  password: text("password", { mode: "text" }).notNull().unique(),
  allowedDates: text("allowed_dates", { mode: "json" })
    .$type<string[] | null>()
    .default(sql`NULL`),
  deviceId: integer("device_id", { mode: "number" })
    .notNull()
    .references(() => Devices.id),
});
