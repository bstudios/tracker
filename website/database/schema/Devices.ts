import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const Devices = sqliteTable("devices", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name", { mode: "text" }).notNull().unique(),
  description: text("description", { mode: "text" }).default(sql`NULL`),
  icon: text("icon", { mode: "text" }).default(sql`NULL`),
  matchId: text("match_id", { mode: "text" }).notNull().unique(), // This is the ID that is used to match the device when a webhook comes in.
});
