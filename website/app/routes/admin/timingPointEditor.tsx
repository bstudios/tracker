import { getCloudflareContext, getDb } from "~/routeContext";
import { and, asc, desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { type MetaFunction } from "react-router";
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

export const meta: MetaFunction = () => {
  return [{ title: "Timing Point Editor" }];
};

const parseDeviceIdInput = async (
  db: ReturnType<typeof getDb>,
  rawDeviceId: FormDataEntryValue | null,
) => {
  const deviceId = parseInt(rawDeviceId as string);
  if (!Number.isFinite(deviceId)) {
    throw new Error("A device must be selected for the timing point.");
  }

  const [device] = await db
    .select({ id: Schema.Devices.id })
    .from(Schema.Devices)
    .where(eq(Schema.Devices.id, deviceId))
    .limit(1);
  if (!device) {
    throw new Error("The selected device does not exist.");
  }

  return device.id;
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

  let refDate = params.date
    ? DateTime.fromFormat(params.date, "yyyy-MM-dd", { zone: "utc" })
    : DateTime.now().toUTC();
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
    .where(and(eq(Schema.Events.dateString, urlDate)));
  const timingPointRows = await db
    .select()
    .from(Schema.TimingPoints)
    .orderBy(asc(Schema.TimingPoints.order));
  const cellRows = await db.select().from(Schema.TimingPointCells);
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
  const devices = await db
    .select({ id: Schema.Devices.id, name: Schema.Devices.name })
    .from(Schema.Devices)
    .orderBy(asc(Schema.Devices.name));

  return {
    date: refDate.toISO(),
    events,
    urlDate,
    editorPath: `/admin/${urlDate}/timingPointEditor`,
    timingPoints,
    devices,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const db = getDb(context);
  const formData = await request.formData();

  if (request.method === "POST") {
    const name = formData.get("name") as string;
    const latitude = parseFloat(formData.get("latitude") as string);
    const longitude = parseFloat(formData.get("longitude") as string);
    const radius = parseInt(formData.get("radius") as string);
    const deviceId = await parseDeviceIdInput(db, formData.get("deviceId"));

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
    const id = parseInt(formData.get("id") as string);
    // Read the owner before the row goes, so we know whose archive to drop.
    const [doomed] = await db
      .select({ deviceId: Schema.TimingPoints.deviceId })
      .from(Schema.TimingPoints)
      .where(eq(Schema.TimingPoints.id, id))
      .limit(1);
    await db
      .delete(Schema.TimingPointCells)
      .where(eq(Schema.TimingPointCells.timingPointId, id));
    await db.delete(Schema.TimingPoints).where(eq(Schema.TimingPoints.id, id));
    if (doomed) await invalidateArchive(context, doomed.deviceId);
    return { success: true };
  } else if (request.method === "PUT") {
    const id = parseInt(formData.get("id") as string);

    const [existingTimingPoint] = await db
      .select({
        id: Schema.TimingPoints.id,
        deviceId: Schema.TimingPoints.deviceId,
      })
      .from(Schema.TimingPoints)
      .where(eq(Schema.TimingPoints.id, id))
      .limit(1);

    if (!existingTimingPoint) {
      throw new Error("Timing point not found");
    }

    // Reshaping is its own request so the details form never has to carry the cells.
    if (formData.get("intent") === "shape") {
      await saveTimingPointCells(db, id, parseCellsInput(formData.get("cells")));
      await invalidateArchive(context, existingTimingPoint.deviceId);
      return { success: true };
    }

    const name = formData.get("name") as string;
    const order = parseInt(formData.get("order") as string);
    const badges = parseBadgesInput(formData.get("badges"));
    const description = parseDescriptionInput(formData.get("description"));
    const deviceId = await parseDeviceIdInput(db, formData.get("deviceId"));

    await db
      .update(Schema.TimingPoints)
      .set({ name, order, deviceId, badges, description })
      .where(eq(Schema.TimingPoints.id, id));

    // A point can be reassigned between devices, so both archives are now suspect.
    await invalidateArchive(context, deviceId);
    if (existingTimingPoint.deviceId !== deviceId) {
      await invalidateArchive(context, existingTimingPoint.deviceId);
    }

    return { success: true };
  }
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <TimingPointEditor
      editorPath={loaderData.editorPath}
      timingPoints={loaderData.timingPoints}
      devices={loaderData.devices}
      pins={loaderData.events.map((event) => ({
        latitude: event.latitude,
        longitude: event.longitude,
        timestamp: event.timestamp,
      }))}
    />
  );
}
