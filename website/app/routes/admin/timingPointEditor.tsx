import { getDb } from "~/routeContext";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { type MetaFunction } from "react-router";
import { TimingPointEditor } from "~/components/TimingPointEditor/TimingPointEditor";
import * as Schema from "~/database/schema.d";
import type { Route } from "./+types/timingPointEditor";

export const meta: MetaFunction = () => {
  return [{ title: "Timing Point Editor" }];
};

const parseApplicableDatesInput = (rawApplicableDates: string) => {
  const normalisedValue = rawApplicableDates.trim();
  if (normalisedValue.length === 0) {
    return [];
  }

  const parsedDates = normalisedValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const date of parsedDates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("Applicable dates must use yyyy-MM-dd format.");
    }
    const parsedDate = DateTime.fromFormat(date, "yyyy-MM-dd", {
      zone: "utc",
    });
    if (!parsedDate.isValid) {
      throw new Error("Applicable dates must be valid calendar dates.");
    }
  }

  return [...new Set(parsedDates)];
};

export async function loader({ context, params }: Route.LoaderArgs) {
  let refDate = params.date
    ? DateTime.fromFormat(params.date, "yyyy-MM-dd", { zone: "utc" })
    : DateTime.now().toUTC();
  refDate = refDate.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
  const urlDate = refDate.toFormat("yyyy-MM-dd");

  const events = await getDb(context)
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
  const timingPoints = await getDb(context)
    .select()
    .from(Schema.TimingPoints)
    .orderBy(asc(Schema.TimingPoints.order));

  return {
    date: refDate.toISO(),
    events,
    urlDate,
    editorPath: `/admin/${urlDate}/timingPointEditor`,
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

    const newTimingPoint = await getDb(context)
      .insert(Schema.TimingPoints)
      .values({ name, latitude, longitude, radius })
      .returning({ id: Schema.TimingPoints.id });
    if (newTimingPoint.length === 0)
      throw new Error("Failed to create timing point");
    return { created: newTimingPoint[0].id };
  } else if (request.method === "DELETE") {
    const id = parseInt(formData.get("id") as string);
    await getDb(context)
      .delete(Schema.TimingPoints)
      .where(eq(Schema.TimingPoints.id, id));
    return { success: true };
  } else if (request.method === "PUT") {
    const id = parseInt(formData.get("id") as string);
    const name = formData.get("name") as string;
    const radius = parseInt(formData.get("radius") as string);
    const order = parseInt(formData.get("order") as string);
    const applicableDatesRaw = formData.get("applicableDates") as string;
    const applicableDates = parseApplicableDatesInput(applicableDatesRaw);
    await getDb(context)
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
      editorPath={loaderData.editorPath}
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
