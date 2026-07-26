import type { DrizzleD1Database } from "drizzle-orm/d1";
import { and, eq, or, sql } from "drizzle-orm";
import * as Schema from "~/database/schema.d";
import { haversineMetersSql } from "./geo";

/**
 * How a device's visit to a timing point is classified.
 *
 * `passage` means only one event matched, so there is nothing to distinguish an arrival
 * from a departure.
 */
export type TimingPointEventType = "arrival" | "departure" | "passage";

export type TimingPointEvent = {
  id: number;
  timestamp: number;
  type: TimingPointEventType;
};

/**
 * Decode the `json_group_array` column produced by `aggregatedEventsSql`.
 *
 * The aggregate emits a `null` type for rows that are neither the first nor the last of a
 * group, which the `WHERE` clause is expected to have already discarded — they are dropped
 * here as well so a caller that forgets cannot render an undefined type.
 */
export const parseTimingPointEvents = (json: string): TimingPointEvent[] => {
  const parsed = JSON.parse(json) as Array<{
    id: number;
    timestamp: number;
    type: TimingPointEventType | null;
  }>;

  return parsed.filter(
    (event): event is TimingPointEvent => event.type !== null,
  );
};

/**
 * Build the CTE chain that matches a device's events against its timing points.
 *
 * Matching is two-stage. Timing points are joined to events through
 * `timing_point_h3_cells`, which cheaply narrows candidates to events in an H3 cell the
 * timing point's radius covers, and only then is the exact haversine distance applied.
 * Matched events are ranked within their group so the first and last can be labelled as an
 * arrival and a departure.
 *
 * The caller composes its own final `SELECT` from the returned handles, because the two
 * consumers want genuinely different shapes: the per-day page left-joins back onto every
 * timing point so those with no matches still render, while the historic comparison groups
 * into a timing-point-by-date matrix. Collapsing those into one flag-driven query would be
 * worse than the duplication this removes.
 */
export function buildTimingPointMatchCtes(
  db: DrizzleD1Database<typeof Schema>,
  args: {
    deviceId: number;
    /** Restrict to a single `YYYY-MM-DD` UTC day. Omit to match across every date. */
    dateString?: string;
    /**
     * Rank arrivals and departures within each date rather than across the whole result.
     * Required when matching across dates, otherwise only the very first and very last
     * match in history would be labelled.
     */
    partitionByDate: boolean;
  },
) {
  const { deviceId, dateString, partitionByDate } = args;

  // Every timing point belonging to the device we are looking at.
  const selectedTimingPoints = db.$with("selected_timing_points").as(
    db
      .select({
        id: Schema.TimingPoints.id,
        name: Schema.TimingPoints.name,
        order: Schema.TimingPoints.order,
        icon: Schema.TimingPoints.icon,
        googleLink: Schema.TimingPoints.googleLink,
        timing_point_latitude: sql<number>`${Schema.TimingPoints.latitude}`.as(
          "timing_point_latitude",
        ),
        timing_point_longitude:
          sql<number>`${Schema.TimingPoints.longitude}`.as(
            "timing_point_longitude",
          ),
        radius: Schema.TimingPoints.radius,
      })
      .from(Schema.TimingPoints)
      .where(eq(Schema.TimingPoints.deviceId, deviceId)),
  );

  // Events near enough to a timing point to be worth measuring, found via the H3 cells
  // that cover each timing point's radius.
  const candidateEvents = db.$with("candidate_events").as(
    db
      .select({
        timing_point_id: selectedTimingPoints.id,
        name: selectedTimingPoints.name,
        order: selectedTimingPoints.order,
        radius: selectedTimingPoints.radius,
        timing_point_latitude:
          sql<number>`${selectedTimingPoints.timing_point_latitude}`.as(
            "timing_point_latitude",
          ),
        timing_point_longitude:
          sql<number>`${selectedTimingPoints.timing_point_longitude}`.as(
            "timing_point_longitude",
          ),
        date: Schema.Events.dateString,
        event_id: Schema.Events.id,
        timestamp: Schema.Events.timestamp,
        event_latitude: sql<number>`${Schema.Events.latitude}`.as(
          "event_latitude",
        ),
        event_longitude: sql<number>`${Schema.Events.longitude}`.as(
          "event_longitude",
        ),
      })
      .from(selectedTimingPoints)
      .innerJoin(
        Schema.TimingPointH3Cells,
        eq(Schema.TimingPointH3Cells.timingPointId, selectedTimingPoints.id),
      )
      .innerJoin(
        Schema.Events,
        eq(Schema.Events.h3Index, Schema.TimingPointH3Cells.h3Index),
      )
      .where(
        and(
          eq(Schema.Events.deviceId, deviceId),
          dateString ? eq(Schema.Events.dateString, dateString) : undefined,
        ),
      ),
  );

  // Candidates that are genuinely inside the timing point's radius.
  const matchingEvents = db.$with("matching_events").as(
    db
      .select({
        timing_point_id: candidateEvents.timing_point_id,
        name: candidateEvents.name,
        order: candidateEvents.order,
        date: candidateEvents.date,
        event_id: candidateEvents.event_id,
        timestamp: candidateEvents.timestamp,
      })
      .from(candidateEvents)
      .where(
        sql`${haversineMetersSql(
          candidateEvents.event_latitude,
          candidateEvents.event_longitude,
          candidateEvents.timing_point_latitude,
          candidateEvents.timing_point_longitude,
        )} <= ${candidateEvents.radius}`,
      ),
  );

  const partition = partitionByDate
    ? sql`${matchingEvents.timing_point_id}, ${matchingEvents.date}`
    : sql`${matchingEvents.timing_point_id}`;

  const rankedEvents = db.$with("ranked_events").as(
    db
      .select({
        timing_point_id: matchingEvents.timing_point_id,
        name: matchingEvents.name,
        order: matchingEvents.order,
        date: matchingEvents.date,
        event_id: matchingEvents.event_id,
        timestamp: matchingEvents.timestamp,
        row_number_asc:
          sql<number>`ROW_NUMBER() OVER(PARTITION BY ${partition} ORDER BY ${matchingEvents.timestamp} ASC)`.as(
            "row_number_asc",
          ),
        row_number_desc:
          sql<number>`ROW_NUMBER() OVER(PARTITION BY ${partition} ORDER BY ${matchingEvents.timestamp} DESC)`.as(
            "row_number_desc",
          ),
        event_count: sql<number>`COUNT(*) OVER(PARTITION BY ${partition})`.as(
          "event_count",
        ),
      })
      .from(matchingEvents),
  );

  /**
   * Aggregate a group's ranked rows into the JSON consumed by `parseTimingPointEvents`.
   *
   * Only meaningful when the surrounding query keeps just the first and last row of each
   * group — see `arrivalOrDepartureOnly`.
   */
  const aggregatedEventsSql = sql<string>`json_group_array(json_object('id', ${rankedEvents.event_id}, 'timestamp', ${rankedEvents.timestamp}, 'type', CASE WHEN ${rankedEvents.event_count} = 1 THEN 'passage' WHEN ${rankedEvents.row_number_asc} = 1 THEN 'arrival' WHEN ${rankedEvents.row_number_desc} = 1 THEN 'departure' END))`;

  /** Keeps only the first and last row of each group, which is all the aggregate needs. */
  const arrivalOrDepartureOnly = or(
    eq(rankedEvents.row_number_asc, 1),
    eq(rankedEvents.row_number_desc, 1),
  );

  return {
    /** Spread into `db.with(...)` before the final select. */
    ctes: [
      selectedTimingPoints,
      candidateEvents,
      matchingEvents,
      rankedEvents,
    ] as const,
    selectedTimingPoints,
    rankedEvents,
    aggregatedEventsSql,
    arrivalOrDepartureOnly,
  };
}
