/**
 * One-off migration of timing points from "a radius around a point" to "a set of H3 cells".
 *
 *   npx tsx scripts/timingPointCells.ts <backfill-events|seed-cells|verify> <--local|--remote>
 *
 * - backfill-events: fill `events.h3_cell` for every event that does not have one yet.
 *   Safe to re-run, which is how events ingested since the last run get picked up.
 * - seed-cells: replace every point's `timing_point_cells` with the cells inside its
 *   current radius, and set its `anchor_cell`.
 * - verify: compare the old radius match with the new cell match over every event and
 *   print where they disagree. Read-only.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { haversineMeters } from "../app/utils/geo";
import {
  anchorCellForCells,
  cellsForCircle,
  timingPointCellForLocation,
} from "../app/utils/timingPointShape";

const [command, target] = process.argv.slice(2);
if (
  !["backfill-events", "seed-cells", "verify"].includes(command) ||
  !["--local", "--remote"].includes(target)
) {
  console.error("usage: timingPointCells.ts <command> <--local|--remote>");
  process.exit(1);
}

const wrangler = (...args: string[]) =>
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", target, "--json", ...args],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
  );

const query = <T>(sql: string): T[] => {
  const output = wrangler("--command", sql);
  return JSON.parse(output.slice(output.indexOf("[")))[0].results as T[];
};

const scratch = mkdtempSync(join(tmpdir(), "timing-point-cells-"));
let fileCount = 0;
const execute = (statements: string[]) => {
  const file = join(scratch, `${fileCount++}.sql`);
  writeFileSync(file, statements.join("\n"));
  wrangler("--file", file);
};

const chunk = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

type Point = {
  id: number;
  device_id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
};

const backfillEvents = () => {
  let total = 0;
  for (;;) {
    const events = query<{ id: number; latitude: number; longitude: number }>(
      "SELECT id, latitude, longitude FROM events WHERE h3_cell = '' ORDER BY id LIMIT 5000",
    );
    if (events.length === 0) break;

    const idsByCell = new Map<string, number[]>();
    for (const event of events) {
      const cell = timingPointCellForLocation(event.latitude, event.longitude);
      idsByCell.set(cell, [...(idsByCell.get(cell) ?? []), event.id]);
    }
    execute(
      [...idsByCell].map(
        ([cell, ids]) =>
          `UPDATE events SET h3_cell = '${cell}' WHERE id IN (${ids.join(",")});`,
      ),
    );
    total += events.length;
    console.log(`backfilled ${total} events`);
  }
  console.log("no events left without a cell");
};

const seedCells = () => {
  const points = query<Point>(
    "SELECT id, device_id, name, latitude, longitude, radius FROM timing_points",
  );
  const statements = ["DELETE FROM timing_point_cells;"];
  let cellCount = 0;

  for (const point of points) {
    const cells = cellsForCircle(point.latitude, point.longitude, point.radius);
    cellCount += cells.length;
    statements.push(
      `UPDATE timing_points SET anchor_cell = '${anchorCellForCells(cells)}' WHERE id = ${point.id};`,
    );
    for (const group of chunk(cells, 200)) {
      statements.push(
        `INSERT INTO timing_point_cells (timing_point_id, h3_index) VALUES ${group
          .map((cell) => `(${point.id}, '${cell}')`)
          .join(", ")};`,
      );
    }
  }

  for (const group of chunk(statements, 50)) execute(group);
  console.log(`seeded ${cellCount} cells for ${points.length} timing points`);
};

const verify = () => {
  const points = query<Point>(
    "SELECT id, device_id, name, latitude, longitude, radius FROM timing_points",
  );
  const cellsByPoint = new Map<number, Set<string>>();
  for (const row of query<{ timing_point_id: number; h3_index: string }>(
    "SELECT timing_point_id, h3_index FROM timing_point_cells",
  )) {
    const cells = cellsByPoint.get(row.timing_point_id) ?? new Set<string>();
    cells.add(row.h3_index);
    cellsByPoint.set(row.timing_point_id, cells);
  }

  const pointsByDevice = new Map<number, Point[]>();
  for (const point of points) {
    pointsByDevice.set(point.device_id, [
      ...(pointsByDevice.get(point.device_id) ?? []),
      point,
    ]);
  }

  const tally = new Map<number, { old: number; both: number; added: number }>();
  for (const point of points) tally.set(point.id, { old: 0, both: 0, added: 0 });

  let lastId = 0;
  let events = 0;
  for (;;) {
    const page = query<{
      id: number;
      device_id: number;
      latitude: number;
      longitude: number;
      h3_cell: string;
    }>(
      `SELECT id, device_id, latitude, longitude, h3_cell FROM events WHERE id > ${lastId} ORDER BY id LIMIT 20000`,
    );
    if (page.length === 0) break;
    lastId = page[page.length - 1].id;
    events += page.length;

    for (const event of page) {
      for (const point of pointsByDevice.get(event.device_id) ?? []) {
        const row = tally.get(point.id)!;
        const wasInside =
          haversineMeters(
            point.latitude,
            point.longitude,
            event.latitude,
            event.longitude,
          ) <= point.radius;
        const isInside = cellsByPoint.get(point.id)?.has(event.h3_cell) ?? false;
        if (wasInside) row.old++;
        if (wasInside && isInside) row.both++;
        if (!wasInside && isInside) row.added++;
      }
    }
  }

  let lostTotal = 0;
  let addedTotal = 0;
  console.log(`checked ${events} events against ${points.length} timing points\n`);
  console.log("id    radius  old    lost   gained  name");
  for (const point of points) {
    const row = tally.get(point.id)!;
    const lost = row.old - row.both;
    lostTotal += lost;
    addedTotal += row.added;
    if (lost > 0 || row.added > 0) {
      console.log(
        `${String(point.id).padEnd(5)} ${String(point.radius).padEnd(7)} ${String(row.old).padEnd(6)} ${String(lost).padEnd(6)} ${String(row.added).padEnd(7)} ${point.name}`,
      );
    }
  }
  console.log(`\nmatches lost: ${lostTotal}, matches gained: ${addedTotal}`);
};

({ "backfill-events": backfillEvents, "seed-cells": seedCells, verify })[
  command as "verify"
]();
