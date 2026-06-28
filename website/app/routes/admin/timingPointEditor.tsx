import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { type MetaFunction } from "react-router";
import { TimingPointEditor } from "~/components/TimingPointEditor/TimingPointEditor";
import * as Schema from "~/database/schema.d";
import type { Route } from "./+types/timingPointEditor";

export const meta: MetaFunction = () => {
  return [{ title: "Timing Point Editor" }];
};

export async function loader({ context, params }: Route.LoaderArgs) {
  let refDate = params.date
    ? DateTime.fromFormat(params.date, "yyyy-MM-dd", { zone: "utc" })
    : DateTime.now().toUTC();
  refDate = refDate.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
  const urlDate = refDate.toFormat("yyyy-MM-dd");

  const events = await context.db
    .select({
      timestamp: Schema.Events.timestamp,
      data: Schema.Events.data,
    })
    .from(Schema.Events)
    .orderBy(desc(Schema.Events.timestamp))
    .where(
      and(
        gte(Schema.Events.timestamp, refDate.toMillis()),
        lte(Schema.Events.timestamp, refDate.toMillis() + 86400000) // 24 hours
      )
    );
  const timingPoints = await context.db
    .select()
    .from(Schema.TimingPoints)
    .orderBy(asc(Schema.TimingPoints.order));

  return {
    date: refDate.toISO(),
    events,
    urlDate,
    timingPoints,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const formData = await request.formData();

  if (request.method === "POST") {
    const name = formData.get("name") as string;
    const latitude = parseFloat(formData.get("latitude") as string);
    const longitude = parseFloat(formData.get("longitude") as string);
    const radius = parseInt(formData.get("radius") as string);

    const newTimingPoint = await context.db
      .insert(Schema.TimingPoints)
      .values({ name, latitude, longitude, radius })
      .returning({ id: Schema.TimingPoints.id });
    if (newTimingPoint.length === 0)
      throw new Error("Failed to create timing point");
    return { created: newTimingPoint[0].id };
  } else if (request.method === "DELETE") {
    const id = parseInt(formData.get("id") as string);
    await context.db
      .delete(Schema.TimingPoints)
      .where(eq(Schema.TimingPoints.id, id));
    return { success: true };
  } else if (request.method === "PUT") {
    const id = parseInt(formData.get("id") as string);
    const name = formData.get("name") as string;
    const radius = parseInt(formData.get("radius") as string);
    const order = parseInt(formData.get("order") as string);
    const applicableDatesRaw = formData.get("applicableDates") as string;
    const applicableDates = applicableDatesRaw.split(",").filter(Boolean);
    await context.db
      .update(Schema.TimingPoints)
      .set({
        name,
        radius,
        order,
        applicableDates,
      })
      .where(eq(Schema.TimingPoints.id, id));
    return { success: true };
  }
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <TimingPointEditor
      timingPoints={loaderData.timingPoints}
      pins={loaderData.events
        .filter(
          (event) =>
            "latitude" in event.data.location &&
            "longitude" in event.data.location
        )
        .map((event) => ({
          latitude: event.data.location.latitude,
          longitude: event.data.location.longitude,
          timestamp: event.timestamp,
        }))}
    />
  );
}
