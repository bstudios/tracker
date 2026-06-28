import { and, asc, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { ensurePasswordAccess } from "~/passwordAccess.server";
import { Events } from "~/database/schema/Events";
import type { Route } from "./+types/downloadGPX";

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { refDate, urlDate } = await ensurePasswordAccess({
    db: context.db,
    password: params.password,
    dateParam: params.date,
    request,
    env: context.cloudflare.env,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let cursor = 0; // D1 offset is 0-based
      const batchSize = 200;

      // Write GPX header first
      controller.enqueue(
        encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><gpx creator="James Bithell Tracker" version="1.1" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/11.xsd" xmlns:ns3="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns2="http://www.garmin.com/xmlschemas/GpxExtensions/v3">
          <metadata>
            <link href="https://jbithell.com">
              <text>James Bithell Tracker</text>
            </link>
            <time>${refDate.toISO()}</time>
          </metadata><trk><name>James Bithell Tracker ${
            params.date
          }</name><type>other</type><trkseg>`)
      );

      try {
        do {
          const databaseResult = await context.db
            .select({
              timestamp: Events.timestamp,
              data: Events.data,
            })
            .from(Events)
            .orderBy(asc(Events.timestamp))
            .limit(batchSize)
            .offset(cursor)
            .where(
              and(
                gte(Events.timestamp, refDate.toMillis()),
                lte(Events.timestamp, refDate.toMillis() + 86400000) // 24 hours
              )
            );
          if (databaseResult.length === 0) {
            break; // No more rows
          }

          const thisRow = databaseResult.map((databaseResult) => {
            if (
              databaseResult.data === null ||
              databaseResult.data === undefined
            )
              return "";
            if (databaseResult.data instanceof Date)
              return databaseResult.data.toISOString(); // Format dates consistently
            return `<trkpt lat="${
              databaseResult.data.location.latitude
            }" lon="${databaseResult.data.location.longitude}">
                      <ele>${databaseResult.data.location.altitude}</ele>
                      <speed>${databaseResult.data.location.speed}</speed>
                      <time>${DateTime.fromMillis(
                        databaseResult.timestamp
                      ).toISO()}</time>
                    </trkpt>`;
          });
          controller.enqueue(encoder.encode(thisRow.join("\n")));
          cursor += databaseResult.length;

          // Optional: Yield for other tasks if running in a tight loop in some environments
          // await new Promise(resolve => setImmediate(resolve));
        } while (true);
      } catch (error) {
        console.error("Error during CSV stream generation:", error);
        controller.error(error); // Signal an error in the stream
      } finally {
        controller.enqueue(encoder.encode(`</trkseg></trk></gpx>`));
        controller.close(); // Signal the end of the stream
      }
    },
  });

  const headers = new Headers();
  headers.set("Content-Type", "application/gpx+xml");
  headers.set(
    "Content-Disposition",
    `attachment; filename="${urlDate}-tracker-export.gpx"`
  );
  headers.set("Cache-Control", "no-cache");
  return new Response(stream, {
    status: 200,
    headers: headers,
  });
}
