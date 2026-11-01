import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Devices } from "./Devices";

export const AccessPasswords = sqliteTable(
  "access_passwords",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    password: text("password", { mode: "text" }).notNull().unique(),
    allowedDates: text("allowed_dates", { mode: "json" })
      .$type<string[] | null>()
      .default(sql`NULL`),
    deviceId: integer("device_id", { mode: "number" })
      .notNull()
      .references(() => Devices.id),
  },
  (table) => [
    // Passwords are matched case-insensitively with `lower(password) = ?`, which the plain
    // unique index on `password` cannot serve.
    index("access_passwords_lower_password_idx").on(
      sql`lower(${table.password})`,
    ),
  ],
);
