import { getCloudflareContext, getDb } from "~/routeContext";
import { loadLogbook } from "~/logbook/loadLogbook.server";
import { verifyLogbookPrintToken } from "~/logbook/printToken.server";
import { renderLogbookDocument } from "~/logbook/renderLogbookHtml";
import type { Route } from "./+types/logbookPrint";

/**
 * The page the nightly logbook PDF is rendered from.
 *
 * A resource route returning a standalone document rather than a normal page, so the PDF
 * has no site chrome and no dependency on client-side rendering. Access is by HMAC in the
 * query string — see `printToken.server.ts` for why this is not behind the usual password.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env } = getCloudflareContext(context);
  const secret = env.PDF_SIGNING_SECRET;

  if (!secret) {
    throw new Response("Logbook PDF signing is not configured", {
      status: 500,
    });
  }

  const deviceId = Number(params.deviceId);
  const dateString = params.date ?? "";
  const token = new URL(request.url).searchParams.get("token") ?? "";

  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    throw new Response("Not found", { status: 404 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new Response("Not found", { status: 404 });
  }

  const isValid = await verifyLogbookPrintToken({
    secret,
    deviceId,
    dateString,
    token,
  });
  if (!isValid) {
    throw new Response("Forbidden", { status: 403 });
  }

  const logbook = await loadLogbook(getDb(context), { deviceId, dateString });
  if (!logbook) {
    throw new Response("Not found", { status: 404 });
  }

  return new Response(
    renderLogbookDocument({
      deviceName: logbook.deviceName,
      dateString,
      entries: logbook.entries,
      eventCount: logbook.eventCount,
      truncated: logbook.truncated,
    }),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Nothing here should be cached by an intermediary; the token is in the URL.
        "Cache-Control": "no-store",
      },
    },
  );
}
