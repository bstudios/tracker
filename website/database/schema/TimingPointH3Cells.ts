import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { TimingPoints } from "./TimingPoints";

export const TimingPointH3Cells = sqliteTable(
  "timing_point_h3_cells",
  {
    timingPointId: integer("timing_point_id", { mode: "number" })
      .notNull()
      .references(() => TimingPoints.id, { onDelete: "cascade" }),
    h3Index: text("h3_index").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.timingPointId, table.h3Index] }),
    index("timing_point_h3_cells_h3_idx").on(table.h3Index),
  ],
);
