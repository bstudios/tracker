import {
  consoleLoggingIntegration,
  type CloudflareOptions,
} from "@sentry/cloudflare";
import {
  SENTRY_DSN,
  SENTRY_ENABLED,
  SENTRY_RELEASE,
  SENTRY_TRACES_SAMPLE_RATE,
} from "~/utils/sentry";

/**
 * Sentry options for everything running inside the worker.
 *
 * Both entry points hand this to their own wrapper — `withSentry` for the request handler
 * in `workers/app.ts`, `instrumentWorkflowWithSentry` for the nightly logbook email — so
 * an error raised while rendering a PDF at 00:05 lands in the same project, with the same
 * release and the same redaction, as one raised serving a page.
 *
 * It is a function of `env` so that the Cloudflare version id can be attached: the release
 * names the commit that was built, which is what the source maps were uploaded under, and
 * the version id names the deploy that is actually running it. Both are worth having when
 * working out whether an error is new code or an old bug someone just walked into.
 */
export const sentryOptions = (env: Env): CloudflareOptions => ({
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  release: SENTRY_RELEASE,
  environment: SENTRY_ENABLED ? "production" : "development",
  initialScope: {
    tags: { cloudflare_version: env.CF_VERSION_METADATA?.id },
  },
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  // `console.*` is already how the rest of the codebase reports anything worth knowing
  // about — a rejected upload, a logbook email that bounced — so routing the console
  // through Sentry is what actually fills the logs view. The same calls still reach the
  // Workers dashboard; this is an additional sink, not a replacement.
  enableLogs: true,
  integrations: [
    consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] }),
  ],
  dataCollection: {
    // The admin session is a Cloudflare Access JWT and the viewing session is a signed
    // cookie; neither is any use in a stack trace and both are a working credential.
    cookies: false,
    // Request bodies are the login form (which posts the viewing password) and the
    // tracker uploads, whose contents are already on the span that handled them.
    httpBodies: [],
    userInfo: false,
  },
});
