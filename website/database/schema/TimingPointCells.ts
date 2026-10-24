import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { TimingPoints } from "./TimingPoints";

/**
 * The shape of each timing point: the set of H3 cells (at `TIMING_POINT_H3_RESOLUTION`)
 * that count as being "at" the point. An event matches a timing point when its
 * `events.h3_cell` is one of these.
 */
export const TimingPointCells = sqliteTable(
  "timing_point_cells",
  {
    timingPointId: integer("timing_point_id", { mode: "number" })
      .notNull()
      .references(() => TimingPoints.id, { onDelete: "cascade" }),
    h3Index: text("h3_index").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.timingPointId, table.h3Index] }),
    // Covers the lookup from an event's cell to the points that include it.
    index("timing_point_cells_h3_idx").on(table.h3Index, table.timingPointId),
  ],
);
