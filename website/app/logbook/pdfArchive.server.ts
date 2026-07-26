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
    const cached = await env.LOGBOOK_ARCHIVE.get(key);
    if (cached) return { body: await cached.arrayBuffer(), cached: true };
  }

  const token = await createLogbookPrintToken({
    secret: env.LOGBOOK_PDF_SIGNING_SECRET,
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
    await env.LOGBOOK_ARCHIVE.put(key, body, {
      httpMetadata: { contentType: "application/pdf" },
    });
  }

  return { body, cached: false };
}

/** Filename for the download, with anything awkward for a filesystem stripped out. */
export const logbookPdfFilename = (deviceName: string, dateString: string) =>
  `logbook-${deviceName.replace(/[^\w-]+/g, "-")}-${dateString}.pdf`;
