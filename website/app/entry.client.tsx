/**
 * By default, Remix will handle hydrating your app on the client for you.
 * You are free to delete this file if you'd like to, but if you ever want it revealed again, you can run `npx remix reveal` ✨
 * For more information, see https://remix.run/file-conventions/entry.client
 */

import * as Sentry from "@sentry/react-router";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import {
  SENTRY_DSN,
  SENTRY_ENABLED,
  SENTRY_RELEASE,
  SENTRY_TRACES_SAMPLE_RATE,
} from "~/utils/sentry";

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  release: SENTRY_RELEASE,
  environment: SENTRY_ENABLED ? "production" : "development",
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  integrations: [Sentry.reactRouterTracingIntegration()],
  // Logs the page sends deliberately, via `Sentry.logger.*`. Unlike the worker, the browser
  // console is not piped in: it also carries React's development warnings and whatever
  // Leaflet has to say about a tile that did not load, none of which is worth a log line.
  enableLogs: true,
  // The login form posts the viewing password and the session cookie is what it buys, so
  // neither is worth sending. Session Replay is left off for the same reason.
  dataCollection: { cookies: false, httpBodies: [], userInfo: false },
});

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter
        // Wraps navigations, fetches and route loaders so a client-side navigation shows up
        // as a trace named after the route rather than one flat pageload.
        instrumentations={[
          // `onError` below already reports everything this would, and with the React
          // component stack attached, so letting both capture would file each error twice.
          Sentry.createSentryClientInstrumentation({ captureErrors: false }),
        ]}
        onError={Sentry.sentryOnError}
      />
    </StrictMode>,
  );
});
