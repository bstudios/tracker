import { DateTime } from "luxon";
import { createLogbookPrintToken } from "./printToken.server";

/**
 * Rendering a logbook PDF at most once.
 *
 * Browser Rendering is the most expensive thing this app does, and a finished day's
 * logbook never changes, so completed days are rendered once and kept in R2. Both the
 * nightly email and the download link on the logbook page go through here, which means
 * whichever happens first warms the cache for the other.
 */

export const logbookPdfKey = (deviceId: number, dateString: string) =>
  `logbook/${deviceId}/${dateString}.pdf`;

/**
 * Whether a UTC day has finished.
 *
 * UTC because that is what `events.date_string` buckets by — the log for a day is only
 * settled once no further events can land in that bucket. Today's log is still growing,
 * so it is rendered fresh every time and never stored.
 */
export const isDayComplete = (dateString: string) =>
  dateString < DateTime.utc().toFormat("yyyy-MM-dd");

export type LogbookPdf = {
  body: ArrayBuffer;
  /** Whether this came from R2 rather than the browser. Surfaced for logging only. */
  cached: boolean;
};

/**
 * Fetch the day's PDF from R2, rendering and storing it if it is not there yet.
 *
 * Returns `null` when Browser Rendering is unavailable — it has no local simulator, so
 * this is the normal case under `npm run dev` and callers should say so rather than fail.
 */
export async function getOrRenderLogbookPdf(
  env: Env,
  args: { deviceId: number; dateString: string },
): Promise<LogbookPdf | null> {
  const { deviceId, dateString } = args;
  const key = logbookPdfKey(deviceId, dateString);
  const complete = isDayComplete(dateString);

  if (complete) {
    const cached = await env.R2_BUCKET.get(key);
    if (cached) return { body: await cached.arrayBuffer(), cached: true };
  }

  const token = await createLogbookPrintToken({
    secret: env.PDF_SIGNING_SECRET,
    deviceId,
    dateString,
  });
  const printUrl = `${env.PUBLIC_BASE_URL}/print/logbook/${deviceId}/${dateString}?token=${token}`;

  let response: Response;
  try {
    response = await env.BROWSER.quickAction("pdf", { url: printUrl });
  } catch {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Logbook PDF render failed for device ${deviceId} on ${dateString}: ${response.status}`,
    );
  }

  const body = await response.arrayBuffer();

  // Only worth keeping once the day can no longer change.
  if (complete) {
    await env.R2_BUCKET.put(key, body, {
      httpMetadata: { contentType: "application/pdf" },
    });
  }

  return { body, cached: false };
}

/** Filename for the download, with anything awkward for a filesystem stripped out. */
export const logbookPdfFilename = (deviceName: string, dateString: string) =>
  `logbook-${deviceName.replace(/[^\w-]+/g, "-")}-${dateString}.pdf`;

/**
 * Drop every archived PDF for a device.
 *
 * A finished day's *events* never change, but the log built from them does: naming a place
 * turns coordinates into a name on every past day the boat stopped there, and editing the
 * voltage bands changes which power lines appear. Both rewrite history, so the whole
 * device's archive is dropped rather than trying to work out which days were affected.
 *
 * Cheap to be wrong about — a missing object is simply re-rendered on next request.
 */
export async function invalidateLogbookArchive(env: Env, deviceId: number) {
  const prefix = `logbook/${deviceId}/`;
  let cursor: string | undefined;

  do {
    const listing = await env.R2_BUCKET.list({ prefix, cursor });
    if (listing.objects.length > 0) {
      await env.R2_BUCKET.delete(listing.objects.map((object) => object.key));
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}
