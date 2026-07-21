import type { DrizzleD1Database } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { getHexagonEdgeLengthAvg, gridDisk } from "h3-js";
import { H3_RESOLUTION } from "~/constants/h3";
import * as Schema from "~/database/schema.d";
import { getH3IndexForLocation } from "~/utils/h3";

const getRingSizeForRadiusMeters = (
  radiusMeters: number,
  resolution = H3_RESOLUTION,
) => {
  const edgeLengthMeters = getHexagonEdgeLengthAvg(resolution, "m");
  if (!Number.isFinite(edgeLengthMeters) || edgeLengthMeters <= 0) {
    return 1;
  }

  // Keep a conservative padding of one ring to avoid false negatives at cell boundaries.
  return Math.max(1, Math.ceil(radiusMeters / edgeLengthMeters) + 1);
};

export const getTimingPointH3Coverage = (args: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  resolution?: number;
}) => {
  const resolution = args.resolution ?? H3_RESOLUTION;
  const centerH3Index = getH3IndexForLocation(
    args.latitude,
    args.longitude,
    resolution,
  );
  const ringSize = getRingSizeForRadiusMeters(args.radiusMeters, resolution);
  const coveringCells = Array.from(new Set(gridDisk(centerH3Index, ringSize)));

  return {
    centerH3Index,
    coveringCells,
  };
};

export const rebuildTimingPointH3Coverage = async (
  db: DrizzleD1Database<typeof Schema>,
  timingPoint: {
    id: number;
    latitude: number;
    longitude: number;
    radius: number;
  },
) => {
  const { centerH3Index, coveringCells } = getTimingPointH3Coverage({
    latitude: timingPoint.latitude,
    longitude: timingPoint.longitude,
    radiusMeters: timingPoint.radius,
  });

  await db
    .update(Schema.TimingPoints)
    .set({ h3Index: centerH3Index })
    .where(eq(Schema.TimingPoints.id, timingPoint.id));

  await db
    .delete(Schema.TimingPointH3Cells)
    .where(eq(Schema.TimingPointH3Cells.timingPointId, timingPoint.id));

  if (coveringCells.length > 0) {
    await db.insert(Schema.TimingPointH3Cells).values(
      coveringCells.map((h3Index) => ({
        timingPointId: timingPoint.id,
        h3Index,
      })),
    );
  }

  return { centerH3Index, coveringCellsCount: coveringCells.length };
};

export const ensureTimingPointH3Coverage = async (
  db: DrizzleD1Database<typeof Schema>,
) => {
  const timingPoints = await db
    .select({
      id: Schema.TimingPoints.id,
      latitude: Schema.TimingPoints.latitude,
      longitude: Schema.TimingPoints.longitude,
      radius: Schema.TimingPoints.radius,
      h3Index: Schema.TimingPoints.h3Index,
    })
    .from(Schema.TimingPoints);

  const helperCounts = await db
    .select({
      timingPointId: Schema.TimingPointH3Cells.timingPointId,
      rowCount: sql<number>`count(*)`.as("row_count"),
    })
    .from(Schema.TimingPointH3Cells)
    .groupBy(Schema.TimingPointH3Cells.timingPointId);

  const helperCountsByTimingPointId = new Map(
    helperCounts.map((row) => [row.timingPointId, row.rowCount]),
  );

  for (const timingPoint of timingPoints) {
    const helperRowCount = helperCountsByTimingPointId.get(timingPoint.id) ?? 0;

    if (timingPoint.h3Index !== "" && helperRowCount > 0) {
      continue;
    }

    await rebuildTimingPointH3Coverage(db, {
      id: timingPoint.id,
      latitude: timingPoint.latitude,
      longitude: timingPoint.longitude,
      radius: timingPoint.radius,
    });
  }
};
