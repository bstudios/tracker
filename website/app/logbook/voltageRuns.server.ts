import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sql, type SQL } from "drizzle-orm";
import * as Schema from "~/database/schema.d";
import type { LogbookVoltageSource } from "./config";

/**
 * Finding voltage band changes in the database rather than in the worker.
 *
 * A tracker reporting every 30 seconds produces a few thousand readings a day, but a
 * logbook only cares about the handful of moments the reading crossed into a different
 * band. Classifying and grouping in SQL means the worker receives one row per *run* of
 * consecutive same-band readings — typically single digits — instead of one per fix.
 */

export type VoltageRun = {
  /** Index into `config.voltage.sources`. */
  sourceIndex: number;
  bandName: string;
  /** Unix milliseconds of the first reading in the run, before normalisation. */
  startTimestamp: number;
  /** The reading that opened the run, for the "12.2 V → 13.9 V" detail. */
  startValue: number;
  /** How many consecutive readings held this band — the input to the hysteresis rule. */
  readingCount: number;
};

/**
 * `CASE WHEN ... THEN ?` mapping a reading to its band name, or NULL if it is in none.
 *
 * Band bounds come from a zod-validated config so they are already numbers, but they are
 * still bound as parameters rather than interpolated — band *names* are free text.
 */
const bandCaseSql = (source: LogbookVoltageSource, value: SQL<number>) => {
  const branches = source.bands.map((band) => {
    const conditions: SQL[] = [];
    if (band.min !== undefined) conditions.push(sql`${value} >= ${band.min}`);
    if (band.max !== undefined) conditions.push(sql`${value} < ${band.max}`);
    return sql`WHEN ${sql.join(conditions, sql` AND `)} THEN ${band.name}`;
  });

  return sql`CASE ${sql.join(branches, sql` `)} ELSE NULL END`;
};

/**
 * Consecutive runs of the same band, oldest first, for one configured source.
 *
 * The run grouping is the standard gaps-and-islands trick: for rows ordered by time, the
 * difference between an overall row number and a per-band row number stays constant for as
 * long as the band does not change, so it identifies each run.
 */
export async function loadVoltageRuns(
  db: DrizzleD1Database<typeof Schema>,
  args: {
    deviceId: number;
    dateString: string;
    sources: LogbookVoltageSource[];
  },
): Promise<VoltageRun[]> {
  const { deviceId, dateString, sources } = args;
  if (sources.length === 0) return [];

  const perSource = await Promise.all(
    sources.map(async (source, sourceIndex) => {
      const value = sql<number>`json_extract(${Schema.Events.data}, ${source.jsonPath})`;
      const band = bandCaseSql(source, value);

      const rows = await db.all<{
        band_name: string;
        start_timestamp: number;
        start_value: number;
        reading_count: number;
      }>(sql`
        WITH readings AS (
          SELECT
            ${Schema.Events.timestamp} AS timestamp,
            ${value} AS value,
            ${band} AS band_name
          FROM ${Schema.Events}
          WHERE ${Schema.Events.deviceId} = ${deviceId}
            AND ${Schema.Events.dateString} = ${dateString}
            AND ${band} IS NOT NULL
        ),
        numbered AS (
          SELECT
            timestamp,
            value,
            band_name,
            ROW_NUMBER() OVER (ORDER BY timestamp)
              - ROW_NUMBER() OVER (PARTITION BY band_name ORDER BY timestamp) AS run_id
          FROM readings
        )
        SELECT
          band_name,
          MIN(timestamp) AS start_timestamp,
          -- SQLite guarantees that bare columns alongside a bare MIN()/MAX() come from the
          -- row that matched, so this is the reading that opened the run.
          value AS start_value,
          COUNT(*) AS reading_count
        FROM numbered
        GROUP BY band_name, run_id
        ORDER BY start_timestamp ASC
      `);

      return rows.map((row) => ({
        sourceIndex,
        bandName: row.band_name,
        startTimestamp: row.start_timestamp,
        startValue: row.start_value,
        readingCount: row.reading_count,
      }));
    }),
  );

  return perSource.flat();
}
