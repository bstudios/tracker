import type { DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as Schema from "~/database/schema.d";
import { anchorCellForCells } from "./timingPointShape";

// D1 allows 100 bound parameters per statement, and each row binds two.
const ROWS_PER_INSERT = 40;
const STATEMENTS_PER_BATCH = 100;

/**
 * Replace a timing point's shape, and the anchor cell derived from it.
 *
 * `cells` is the whole shape, not a change to it. Everything goes through `db.batch` so a
 * point is never left with half of its old shape and half of its new one.
 */
export const saveTimingPointCells = async (
  db: DrizzleD1Database<typeof Schema>,
  timingPointId: number,
  cells: readonly string[],
) => {
  const uniqueCells = Array.from(new Set(cells));
  const anchorCell = anchorCellForCells(uniqueCells);

  const statements: BatchItem<"sqlite">[] = [
    db
      .update(Schema.TimingPoints)
      .set({ anchorCell })
      .where(eq(Schema.TimingPoints.id, timingPointId)),
    db
      .delete(Schema.TimingPointCells)
      .where(eq(Schema.TimingPointCells.timingPointId, timingPointId)),
  ];
  for (let start = 0; start < uniqueCells.length; start += ROWS_PER_INSERT) {
    statements.push(
      db.insert(Schema.TimingPointCells).values(
        uniqueCells.slice(start, start + ROWS_PER_INSERT).map((h3Index) => ({
          timingPointId,
          h3Index,
        })),
      ),
    );
  }

  for (let start = 0; start < statements.length; start += STATEMENTS_PER_BATCH) {
    const batch = statements.slice(start, start + STATEMENTS_PER_BATCH);
    await db.batch(batch as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
  return { anchorCell };
};
