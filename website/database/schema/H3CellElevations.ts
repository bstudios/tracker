import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Ground elevation for an H3 cell at `TIMING_POINT_H3_RESOLUTION`, so it joins directly onto
 * `events.h3_cell` and `timing_point_cells.h3_index`. The trackers report no usable altitude
 * (flespi sends 0), so this comes from a terrain model instead.
 *
 * It belongs to the ground, not to a device or a day, which is why there is one row per cell
 * however many devices have passed through it. Nothing fills it automatically: it was
 * loaded by a one-off backfill from the Open-Meteo elevation API (Copernicus GLO-90).
 */
export const H3CellElevations = sqliteTable("h3_cell_elevations", {
  h3Cell: text("h3_cell").primaryKey(),
  // Metres above sea level at the cell's centre.
  elevationMeters: real("elevation_meters").notNull(),
  // Which dataset the value came from, e.g. "copernicus-glo90", in case a finer one is added.
  source: text("source").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});
