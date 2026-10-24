import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Devices } from "./Devices";

/**
 * A point in a device's logbook from which a new crew is aboard.
 *
 * Every row is a complete crew, not a delta: whoever is listed in `LogbookCrewMembers`
 * against it is the whole crew from `timestamp` until the next change. That keeps "who was
 * aboard at 14:00?" a single lookup of the latest change before then, rather than replaying
 * every join and leave since the start of the season.
 *
 * `dateString` follows the same rule as `LogbookRemarks`: it is the day the change was
 * entered *for*, not derived from `timestamp`.
 */
export const LogbookCrewChanges = sqliteTable(
  "logbook_crew_changes",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    deviceId: integer("device_id", { mode: "number" })
      .notNull()
      .references(() => Devices.id),
    dateString: text("date_string").notNull(),
    // Unix milliseconds — when the crew took over, not when it was written down.
    timestamp: integer("timestamp", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("logbook_crew_changes_device_dateString_idx").on(
      table.deviceId,
      table.dateString,
    ),
    index("logbook_crew_changes_device_timestamp_idx").on(
      table.deviceId,
      table.timestamp,
    ),
  ],
);

/**
 * One person in one crew change, and the role they held in it.
 *
 * A row per person rather than a JSON list on the change, so "every watch this person has
 * stood, and as what" stays a plain indexed query on `name`. Names and roles are free text
 * for now — there is no people table to point at yet.
 */
export const LogbookCrewMembers = sqliteTable(
  "logbook_crew_members",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    crewChangeId: integer("crew_change_id", { mode: "number" })
      .notNull()
      .references(() => LogbookCrewChanges.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Empty when no role was given.
    role: text("role").notNull().default(""),
    // Order the crew was listed in, so the log reads back the way it was written.
    position: integer("position", { mode: "number" }).notNull(),
  },
  (table) => [
    index("logbook_crew_members_crewChangeId_idx").on(table.crewChangeId),
    index("logbook_crew_members_name_idx").on(table.name),
  ],
);
