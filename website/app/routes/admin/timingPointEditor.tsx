import { getCloudflareContext, getDb } from "~/routeContext";
import { and, asc, desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { TimingPointEditor } from "~/components/TimingPointEditor/TimingPointEditor";
import * as Schema from "~/database/schema.d";
import { compactCells, getResolution, isValidCell } from "h3-js";
import { TIMING_POINT_H3_RESOLUTION } from "~/constants/h3";
import { saveTimingPointCells } from "~/utils/timingPointCells.server";
import {
  anchorCellForCells,
  cellsForCircle,
  timingPointLatLng,
} from "~/utils/timingPointShape";
import { invalidateLogbookArchive } from "~/logbook/pdfArchive.server";
import type { Route } from "./+types/timingPointEditor";

/**
 * Timing points name the places in every past day's logbook, so changing one makes the
 * archived PDFs disagree with what the page would now render.
 */
const invalidateArchive = (
  context: Route.ActionArgs["context"],
  deviceId: number,
) => invalidateLogbookArchive(getCloudflareContext(context).env, deviceId);

export const meta: Route.MetaFunction = ({ loaderData }) => {
  return [
    {
      title: loaderData
        ? `Timing Points – ${loaderData.device.name}`
        : "Timing Point Editor",
    },
  ];
};

const parseDeviceIdParam = (rawId: string | undefined) => {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Response("Not found", { status: 404 });
  }
  return id;
};

const parseBadgesInput = (raw: FormDataEntryValue | null) =>
  Array.from(
    new Set(
      ((raw as string | null) ?? "")
        .split(",")
        .map((badge) => badge.trim())
        .filter((badge) => badge.length > 0),
    ),
  );

const parseDescriptionInput = (raw: FormDataEntryValue | null) => {
  const description = ((raw as string | null) ?? "").trim();
  return description.length > 0 ? description : null;
};

const parseCellsInput = (raw: FormDataEntryValue | null) => {
  const cells: unknown = JSON.parse((raw as string | null) ?? "[]");
  if (
    !Array.isArray(cells) ||
    cells.length === 0 ||
    !cells.every(
      (cell) =>
        typeof cell === "string" &&
        isValidCell(cell) &&
        getResolution(cell) === TIMING_POINT_H3_RESOLUTION,
    )
  ) {
    throw new Error("A timing point needs a shape made of at least one cell.");
  }
  return cells as string[];
};

export async function loader({ context, params }: Route.LoaderArgs) {
  const db = getDb(context);
  const deviceId = parseDeviceIdParam(params.deviceId);

  const [device] = await db
    .select({ id: Schema.Devices.id, name: Schema.Devices.name })
    .from(Schema.Devices)
    .where(eq(Schema.Devices.id, deviceId))
    .limit(1);
  if (!device) {
    throw new Response("Device not found", { status: 404 });
  }

  // The days this device has a track for, so one can be drawn under the timing points.
  const availableDates = (
    await db
      .select({ date: Schema.Events.dateString })
      .from(Schema.Events)
      .where(eq(Schema.Events.deviceId, deviceId))
      .groupBy(Schema.Events.dateString)
      .orderBy(desc(Schema.Events.dateString))
  ).map((row) => row.date);

  // Without a date, show the device's most recent track.
  let refDate = params.date
    ? DateTime.fromFormat(params.date, "yyyy-MM-dd", { zone: "utc" })
    : availableDates[0]
      ? DateTime.fromFormat(availableDates[0], "yyyy-MM-dd", { zone: "utc" })
      : DateTime.now().toUTC();
  if (!refDate.isValid) {
    throw new Response("Not found", { status: 404 });
  }
  refDate = refDate.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
  const urlDate = refDate.toFormat("yyyy-MM-dd");

  const events = await db
    .select({
      timestamp: Schema.Events.timestamp,
      latitude: Schema.Events.latitude,
      longitude: Schema.Events.longitude,
    })
    .from(Schema.Events)
    .orderBy(desc(Schema.Events.timestamp))
    .where(
      and(
        eq(Schema.Events.deviceId, deviceId),
        eq(Schema.Events.dateString, urlDate),
      ),
    );
  const timingPointRows = await db
    .select()
    .from(Schema.TimingPoints)
    .where(eq(Schema.TimingPoints.deviceId, deviceId))
    .orderBy(asc(Schema.TimingPoints.order));
  const cellRows = await db
    .select({
      timingPointId: Schema.TimingPointCells.timingPointId,
      h3Index: Schema.TimingPointCells.h3Index,
    })
    .from(Schema.TimingPointCells)
    .innerJoin(
      Schema.TimingPoints,
      eq(Schema.TimingPoints.id, Schema.TimingPointCells.timingPointId),
    )
    .where(eq(Schema.TimingPoints.deviceId, deviceId));
  const cellsByTimingPoint = new Map<number, string[]>();
  for (const { timingPointId, h3Index } of cellRows) {
    cellsByTimingPoint.set(timingPointId, [
      ...(cellsByTimingPoint.get(timingPointId) ?? []),
      h3Index,
    ]);
  }
  // Shapes travel compacted — a large point is thousands of cells but a few dozen once
  // neighbouring cells are merged into their parents. The editor expands them again.
  const timingPoints = timingPointRows.map((timingPoint) => ({
    ...timingPoint,
    ...timingPointLatLng(timingPoint.anchorCell),
    cells: compactCells(cellsByTimingPoint.get(timingPoint.id) ?? []),
  }));

  return {
    device,
    events,
    urlDate,
    availableDates,
    editorBasePath: `/admin/devices/${deviceId}/timingPoints`,
    editorPath: `/admin/devices/${deviceId}/timingPoints/${urlDate}`,
    timingPoints,
  };
}

/** The point being changed, as long as it belongs to the device whose page this is. */
const findDeviceTimingPoint = async (
  db: ReturnType<typeof getDb>,
  deviceId: number,
  rawId: FormDataEntryValue | null,
) => {
  const [timingPoint] = await db
    .select({ id: Schema.TimingPoints.id })
    .from(Schema.TimingPoints)
    .where(
      and(
        eq(Schema.TimingPoints.id, parseInt(rawId as string)),
        eq(Schema.TimingPoints.deviceId, deviceId),
      ),
    )
    .limit(1);
  if (!timingPoint) {
    throw new Error("Timing point not found");
  }
  return timingPoint.id;
};

export async function action({ context, params, request }: Route.ActionArgs) {
  const db = getDb(context);
  const deviceId = parseDeviceIdParam(params.deviceId);
  const formData = await request.formData();

  if (request.method === "POST") {
    const name = formData.get("name") as string;
    const latitude = parseFloat(formData.get("latitude") as string);
    const longitude = parseFloat(formData.get("longitude") as string);
    const radius = parseInt(formData.get("radius") as string);

    const [device] = await db
      .select({ id: Schema.Devices.id })
      .from(Schema.Devices)
      .where(eq(Schema.Devices.id, deviceId))
      .limit(1);
    if (!device) {
      throw new Error("The device does not exist.");
    }

    // A new point starts as a circle around where it was placed; its shape is then
    // adjusted cell by cell.
    // The anchor is set on insert so no page ever reads a point that has no position.
    const cells = cellsForCircle(latitude, longitude, radius);
    const [newTimingPoint] = await db
      .insert(Schema.TimingPoints)
      .values({ name, deviceId, anchorCell: anchorCellForCells(cells) })
      .returning({ id: Schema.TimingPoints.id });
    if (!newTimingPoint) throw new Error("Failed to create timing point");

    await saveTimingPointCells(db, newTimingPoint.id, cells);

    await invalidateArchive(context, deviceId);
    return { created: newTimingPoint.id };
  } else if (request.method === "DELETE") {
    const id = await findDeviceTimingPoint(db, deviceId, formData.get("id"));
    await db
      .delete(Schema.TimingPointCells)
      .where(eq(Schema.TimingPointCells.timingPointId, id));
    await db.delete(Schema.TimingPoints).where(eq(Schema.TimingPoints.id, id));
    await invalidateArchive(context, deviceId);
    return { success: true };
  } else if (request.method === "PUT") {
    const id = await findDeviceTimingPoint(db, deviceId, formData.get("id"));

    // Reshaping is its own request so the details form never has to carry the cells.
    if (formData.get("intent") === "shape") {
      await saveTimingPointCells(db, id, parseCellsInput(formData.get("cells")));
      await invalidateArchive(context, deviceId);
      return { success: true };
    }

    const name = formData.get("name") as string;
    const order = parseInt(formData.get("order") as string);
    const badges = parseBadgesInput(formData.get("badges"));
    const description = parseDescriptionInput(formData.get("description"));

    await db
      .update(Schema.TimingPoints)
      .set({ name, order, badges, description })
      .where(eq(Schema.TimingPoints.id, id));

    await invalidateArchive(context, deviceId);
    return { success: true };
  }
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <TimingPointEditor
      // Remount on a new day so the map recentres on that day's track.
      key={loaderData.urlDate}
      device={loaderData.device}
      urlDate={loaderData.urlDate}
      availableDates={loaderData.availableDates}
      editorBasePath={loaderData.editorBasePath}
      editorPath={loaderData.editorPath}
      timingPoints={loaderData.timingPoints}
      pins={loaderData.events.map((event) => ({
        latitude: event.latitude,
        longitude: event.longitude,
        timestamp: event.timestamp,
      }))}
    />
  );
}
