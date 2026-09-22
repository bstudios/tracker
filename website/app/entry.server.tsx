import * as Sentry from "@sentry/react-router/cloudflare";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import type {
  EntryContext,
  HandleErrorFunction,
  RouterContextProvider,
} from "react-router";
import { ServerRouter } from "react-router";

async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  const stream = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log streaming rendering errors from inside the shell.  Don't log
        // errors encountered during initial shell rendering since they'll
        // reject and get logged in handleDocumentRequest.
        if (shellRendered) {
          console.error(error);
        }
      },
    },
  );
  shellRendered = true;

  // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
  // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await stream.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  // Writes the current trace id into <head> so the browser SDK continues the server's
  // trace instead of starting its own. Without it a slow page and the request that served
  // it are two unrelated traces in Sentry.
  return new Response(Sentry.injectTraceMetaTags(stream), {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}

/**
 * Errors React Router caught on the server — a loader or action that threw, a render that
 * failed — which otherwise only reach the `ErrorBoundary` in `root.tsx`.
 *
 * A client that navigates away mid-request aborts the signal, and every in-flight loader
 * throws as a result. Those are not faults, so they are dropped rather than reported.
 */
export const handleError: HandleErrorFunction = (error, { request }) => {
  if (request.signal.aborted) return;
  Sentry.captureException(error);
  console.error(error);
};

// Names the request span after the route that matched (`/:password/:date/logbook` rather
// than the URL that came in), so Sentry groups requests by page instead of by password.
export default Sentry.wrapSentryHandleRequest(handleRequest);
