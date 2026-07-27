import { DateTime } from "luxon";
import { createLogbookPrintToken } from "./printToken.server";
import { formatDateTimeMed } from "~/utils/dateTime";

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
 * Returns `null` when Browser Rendering is unavailable — the binding is configured
 * `remote: true` in wrangler.jsonc, so `npm run dev` proxies to the real service rather
 * than simulating it, but it can still fail to reach it (offline, no Cloudflare auth).
 * Callers should say so rather than fail.
 *
 * Pass `force: true` to skip the cache read and re-render even though a copy already
 * exists — for a viewer who renamed a timing point and wants this one day's PDF caught up
 * without waiting on `invalidateLogbookArchive` to have been called for it, or as a manual
 * fallback if it wasn't.
 */
export async function getOrRenderLogbookPdf(
  env: Env,
  args: { deviceId: number; dateString: string; force?: boolean },
): Promise<LogbookPdf | null> {
  const { deviceId, dateString, force = false } = args;
  const key = logbookPdfKey(deviceId, dateString);
  const complete = isDayComplete(dateString);

  if (complete && !force) {
    const cached = await env.R2_BUCKET.get(key);
    if (cached) return { body: await cached.arrayBuffer(), cached: true };
  }

  const token = await createLogbookPrintToken({
    secret: env.PDF_SIGNING_SECRET,
    deviceId,
    dateString,
  });
  const printUrl = `${env.PUBLIC_BASE_URL}/print/logbook/${deviceId}/${dateString}?token=${token}`;

  const generatedAt = formatDateTimeMed(Date.now());

  let response: Response;
  try {
    response = await env.BROWSER.quickAction("pdf", {
      url: printUrl,
      pdfOptions: {
        printBackground: true,
        margin: { top: "22mm", bottom: "18mm", left: "14mm", right: "14mm" },
        displayHeaderFooter: true,
        // Puppeteer templates: rendered in their own tiny frame, so every style must be
        // inline — the document's own <style> doesn't reach them. `.title` is filled in by
        // Chrome from document.title; `.pageNumber`/`.totalPages` from the render itself.
        // Chrome's built-in classes carry their own default sizing, so every element gets
        // an explicit font-size rather than relying on inheritance from the wrapper.
        headerTemplate: `
          <div style="width:100%; margin:0 14mm; font-family:-apple-system,Helvetica,Arial,sans-serif; border-bottom:1px solid #ccc; padding-bottom:5px;">
            <span class="title" style="font-size:15px; color:#333;"></span>
          </div>`,
        footerTemplate: `
          <div style="width:100%; margin:0 14mm; font-family:-apple-system,Helvetica,Arial,sans-serif; display:flex; justify-content:space-between; border-top:1px solid #ccc; padding-top:5px;">
            <span style="font-size:13px; color:#777;">Generated ${generatedAt}</span>
            <span style="font-size:13px; color:#777;">Page <span class="pageNumber" style="font-size:13px;"></span> of <span class="totalPages" style="font-size:13px;"></span></span>
          </div>`,
      },
    });
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
