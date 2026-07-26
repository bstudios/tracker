import { getDb } from "~/routeContext";
import { and, asc, desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { type MetaFunction } from "react-router";
import { TimingPointEditor } from "~/components/TimingPointEditor/TimingPointEditor";
import * as Schema from "~/database/schema.d";
import {
  getTimingPointH3Coverage,
  rebuildTimingPointH3Coverage,
} from "~/utils/timingPointH3";
import type { Route } from "./+types/timingPointEditor";

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
  const timingPoints = await db
    .select()
    .from(Schema.TimingPoints)
    .orderBy(asc(Schema.TimingPoints.order));
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

    const { centerH3Index, coveringCells } = getTimingPointH3Coverage({
      latitude,
      longitude,
      radiusMeters: radius,
    });

    const newTimingPoint = await db
      .insert(Schema.TimingPoints)
      .values({
        name,
        deviceId,
        latitude,
        longitude,
        radius,
        h3Index: centerH3Index,
      })
      .returning({ id: Schema.TimingPoints.id });
    if (newTimingPoint.length === 0)
      throw new Error("Failed to create timing point");

    if (coveringCells.length > 0) {
      await db.insert(Schema.TimingPointH3Cells).values(
        coveringCells.map((h3Index) => ({
          timingPointId: newTimingPoint[0].id,
          h3Index,
        })),
      );
    }

    return { created: newTimingPoint[0].id };
  } else if (request.method === "DELETE") {
    const id = parseInt(formData.get("id") as string);
    await db
      .delete(Schema.TimingPointH3Cells)
      .where(eq(Schema.TimingPointH3Cells.timingPointId, id));
    await db.delete(Schema.TimingPoints).where(eq(Schema.TimingPoints.id, id));
    return { success: true };
  } else if (request.method === "PUT") {
    const id = parseInt(formData.get("id") as string);
    const name = formData.get("name") as string;
    const radius = parseInt(formData.get("radius") as string);
    const order = parseInt(formData.get("order") as string);
    const deviceId = await parseDeviceIdInput(db, formData.get("deviceId"));

    const [existingTimingPoint] = await db
      .select({
        id: Schema.TimingPoints.id,
        latitude: Schema.TimingPoints.latitude,
        longitude: Schema.TimingPoints.longitude,
      })
      .from(Schema.TimingPoints)
      .where(eq(Schema.TimingPoints.id, id))
      .limit(1);

    if (!existingTimingPoint) {
      throw new Error("Timing point not found");
    }

    const { centerH3Index } = getTimingPointH3Coverage({
      latitude: existingTimingPoint.latitude,
      longitude: existingTimingPoint.longitude,
      radiusMeters: radius,
    });

    await db
      .update(Schema.TimingPoints)
      .set({
        name,
        radius,
        order,
        deviceId,
        h3Index: centerH3Index,
      })
      .where(eq(Schema.TimingPoints.id, id));

    await rebuildTimingPointH3Coverage(db, {
      id,
      latitude: existingTimingPoint.latitude,
      longitude: existingTimingPoint.longitude,
      radius,
    });

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
