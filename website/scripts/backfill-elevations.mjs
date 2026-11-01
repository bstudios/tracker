// Fills `h3_cell_elevations` for the route a device drove on one or more days.
//
//   node scripts/backfill-elevations.mjs --device 2 --date 2025-11-02 --date 2026-11-01 --remote
//
// Every cell a fix landed in is included, plus the cells on the straight line between
// consecutive fixes, so the route is continuous rather than a dotted line of ~10 m cells
// spaced however far the vehicle moved between reports. Cells that already have an
// elevation are skipped, so re-running is cheap.
//
// Elevations come from the Open-Meteo elevation API (Copernicus GLO-90 DEM, ~90 m grid),
// looked up once per resolution-11 parent and shared by its children. Only cell centres are
// sent to it — no timestamps or device details. The free tier allows roughly 5,000
// locations an hour and 10,000 a day; when that runs out the script saves what it has and
// stops, and re-running carries on from there.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cellToLatLng,
  cellToParent,
  gridDistance,
  gridPathCells,
  latLngToCell,
} from "h3-js";
import { TIMING_POINT_H3_RESOLUTION } from "../app/constants/h3.ts";

const SOURCE = "copernicus-glo90";
// Consecutive fixes further apart than this (in cells, ~10 m each) are a signal gap, not a
// straight piece of road, so nothing is drawn between them.
const MAX_FILL_CELLS = 40;
// Cells about 50 m across, a little finer than the terrain model's own grid.
const ELEVATION_LOOKUP_RESOLUTION = 11;
const ELEVATION_BATCH = 100;
const INSERT_BATCH = 500;

const args = process.argv.slice(2);
const flagValues = (name) =>
  args.flatMap((arg, i) => (arg === name ? [args[i + 1]] : []));
const deviceId = Number(flagValues("--device")[0]);
const dates = flagValues("--date");
const target = args.includes("--remote") ? "--remote" : "--local";

if (!Number.isInteger(deviceId) || dates.length === 0) {
  console.error(
    "Usage: node scripts/backfill-elevations.mjs --device <id> --date <YYYY-MM-DD> [--date ...] [--remote]",
  );
  process.exit(1);
}
for (const date of dates) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`Not a YYYY-MM-DD date: ${date}`);
    process.exit(1);
  }
}

const d1 = (extra) =>
  JSON.parse(
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "DB", target, "--json", ...extra],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    ),
  );
const query = (sql) => d1(["--command", sql]).flatMap((r) => r.results);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const routeCells = new Set();
for (const date of dates) {
  const fixes = query(
    `SELECT latitude, longitude FROM events WHERE device_id = ${deviceId} AND date_string = '${date}' ORDER BY timestamp`,
  );
  // Recomputed from the position rather than read from `events.h3_cell`, which is empty on
  // rows written before that column existed.
  const cells = fixes.map((f) =>
    latLngToCell(f.latitude, f.longitude, TIMING_POINT_H3_RESOLUTION),
  );
  cells.forEach((cell, i) => {
    routeCells.add(cell);
    const previous = cells[i - 1];
    if (!previous || previous === cell) return;
    try {
      if (gridDistance(previous, cell) <= MAX_FILL_CELLS) {
        gridPathCells(previous, cell).forEach((c) => routeCells.add(c));
      }
    } catch {
      // h3 cannot path across a pentagon or between distant cells; the fixes still count.
    }
  });
  console.log(`${date}: ${fixes.length} fixes`);
}

const allCells = [...routeCells];
const known = new Set();
for (let i = 0; i < allCells.length; i += INSERT_BATCH) {
  const list = allCells
    .slice(i, i + INSERT_BATCH)
    .map((c) => `'${c}'`)
    .join(",");
  query(
    `SELECT h3_cell FROM h3_cell_elevations WHERE h3_cell IN (${list})`,
  ).forEach((r) => known.add(r.h3_cell));
}
const missing = allCells.filter((c) => !known.has(c));
console.log(
  `${allCells.length} route cells, ${known.size} already stored, fetching ${missing.length}`,
);

// One lookup per parent cell: the terrain model's grid is ~90 m, so asking for every ~10 m
// cell would spend the API's rate limit fetching near-identical values.
const byParent = new Map();
for (const cell of missing) {
  const parent = cellToParent(cell, ELEVATION_LOOKUP_RESOLUTION);
  byParent.set(parent, [...(byParent.get(parent) ?? []), cell]);
}
const parents = [...byParent.keys()];
console.log(`${parents.length} elevation lookups`);

const now = Date.now();
const dir = mkdtempSync(join(tmpdir(), "elevations-"));
let pending = [];
let inserted = 0;
// Written as it goes, so a run cut short by the rate limit keeps what it fetched and the
// next run only asks for what is still missing.
const flush = () => {
  if (!pending.length) return;
  const values = pending
    .map(([cell, metres]) => `('${cell}', ${metres}, '${SOURCE}', ${now})`)
    .join(",\n");
  const file = join(dir, `batch-${inserted}.sql`);
  writeFileSync(
    file,
    `INSERT OR IGNORE INTO h3_cell_elevations (h3_cell, elevation_meters, source, created_at) VALUES\n${values};\n`,
  );
  d1(["--file", file]);
  inserted += pending.length;
  pending = [];
};

let quotaMessage = null;
try {
  lookups: for (let i = 0; i < parents.length; i += ELEVATION_BATCH) {
    const batch = parents.slice(i, i + ELEVATION_BATCH);
    const centres = batch.map((c) => cellToLatLng(c));
    const url =
      "https://api.open-meteo.com/v1/elevation?latitude=" +
      centres.map(([lat]) => lat.toFixed(6)).join(",") +
      "&longitude=" +
      centres.map(([, lng]) => lng.toFixed(6)).join(",");
    let elevation;
    for (let attempt = 1; !elevation; attempt++) {
      const response = await fetch(url);
      if (response.ok) {
        ({ elevation } = await response.json());
      } else if (response.status === 429 && attempt < 4) {
        // Short bursts are throttled per minute; wait that out before deciding it is the
        // hourly or daily quota.
        await sleep(20_000 * attempt);
      } else if (response.status === 429) {
        quotaMessage = await response.text();
        break lookups;
      } else {
        throw new Error(`Open-Meteo returned ${response.status}`);
      }
    }
    batch.forEach((parent, j) =>
      byParent
        .get(parent)
        .forEach((cell) => pending.push([cell, elevation[j]])),
    );
    if (pending.length >= INSERT_BATCH) flush();
    process.stdout.write(
      `\r${Math.min(i + ELEVATION_BATCH, parents.length)}/${parents.length} lookups`,
    );
    await sleep(1_500);
  }
  if (parents.length) process.stdout.write("\n");
  flush();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (quotaMessage) {
  console.log(`Open-Meteo's rate limit is used up: ${quotaMessage}`);
  console.log(
    `Saved ${inserted} elevations; run the same command again later to fetch the rest.`,
  );
} else {
  console.log(`Inserted ${inserted} elevations`);
}
