import {
  getCloudflareContext,
  getDb,
  getPasswordRouteAccess,
} from "~/routeContext";
import { eq } from "drizzle-orm";
import * as Schema from "~/database/schema.d";
import {
  getOrRenderLogbookPdf,
  isDayComplete,
  logbookPdfFilename,
} from "~/logbook/pdfArchive.server";
import type { Route } from "./+types/logbookPdf";

/**
 * Download the day's logbook as a PDF.
 *
 * Offered for finished days only. Today's log is still growing, so a downloaded copy would
 * be out of date before it finished saving — and it is the one day that cannot be cached.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflareContext(context);
  const { urlDate, deviceId } = getPasswordRouteAccess(context);

  if (!isDayComplete(urlDate)) {
    throw new Response("The logbook for this day is not finished yet", {
      status: 404,
    });
  }

  const [device] = await getDb(context)
    .select({ name: Schema.Devices.name })
    .from(Schema.Devices)
    .where(eq(Schema.Devices.id, deviceId))
    .limit(1);

  if (!device) throw new Response("Not found", { status: 404 });

  const pdf = await getOrRenderLogbookPdf(env, {
    deviceId,
    dateString: urlDate,
  });

  if (!pdf) {
    throw new Response(
      "PDF rendering is unavailable. Browser Rendering has no local simulator, so this only works on a deployed worker or under `wrangler dev --remote`.",
      { status: 503 },
    );
  }

  return new Response(pdf.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${logbookPdfFilename(device.name, urlDate)}"`,
      // The day is finished, so the bytes will not change. Private because the URL is
      // behind a viewing password and should not be held by a shared cache.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
