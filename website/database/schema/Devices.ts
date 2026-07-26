import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const Devices = sqliteTable("devices", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name", { mode: "text" }).notNull().unique(),
  description: text("description", { mode: "text" }).default(sql`NULL`),
  icon: text("icon", { mode: "text" }).default(sql`NULL`),
  matchId: text("match_id", { mode: "text" }).notNull().unique(), // This is the ID that is used to match the device when a webhook comes in.
  // How this device's day is condensed into logbook lines: stationary thresholds and the
  // voltage bands that mark engine start/stop and going on or off charge. NULL means never
  // configured, which `parseLogbookConfig` treats identically to `{}`.
  //
  // Deliberately left as unvalidated JSON rather than `$type<LogbookConfig>()`: nothing
  // stops a hand-edited or out-of-date row from failing to match the current shape, so
  // asserting the type here would be a promise the database cannot keep. Read it through
  // `parseLogbookConfig`, which is what actually establishes the type.
  logbookConfig: text("logbook_config", { mode: "json" }).default(sql`NULL`),
  // Comma separated addresses the nightly logbook PDF is emailed to. NULL or empty
  // disables the email for this device.
  logbookEmailRecipients: text("logbook_email_recipients", {
    mode: "text",
  }).default(sql`NULL`),
});
