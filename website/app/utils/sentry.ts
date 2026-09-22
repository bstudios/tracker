/**
 * The parts of the Sentry setup that both halves of the app have to agree on.
 *
 * The browser and the worker report into the same Sentry project, so the DSN, the release
 * and the sample rate live here rather than being written out twice in `entry.client.tsx`
 * and `sentry.server.ts`.
 *
 * The DSN is not a secret — it ships inside the client bundle whatever we do, and it only
 * grants permission to write events to this one project — so it is a plain constant
 * rather than a binding. That keeps the two halves in step without needing a build-time
 * environment variable that the browser build would have no way to read.
 */

export const SENTRY_DSN =
  "https://1683d0b8a14e80e1bd464fb23d62e450@o83272.ingest.us.sentry.io/4512129566900224";

/**
 * Sentry only reports from production builds.
 *
 * `npm run dev` throws plenty of errors that are the whole point of running it, and a
 * local worker has no release for them to hang off, so sending them would only bury the
 * real signal. Vite sets `import.meta.env.PROD` in the client build and the worker build
 * alike, so both sides reach the same answer.
 */
export const SENTRY_ENABLED = import.meta.env.PROD;

/**
 * The commit the running code was built from, which the deploy also files the uploaded
 * source maps under — see `sentryRelease` in `vite.config.ts`, which bakes it in at build
 * time because neither the worker nor the browser can read the build environment.
 *
 * Empty on any build that did not set it, which is every local one; Sentry then simply
 * records no release for the event.
 */
export const SENTRY_RELEASE: string | undefined =
  import.meta.env.VITE_SENTRY_RELEASE || undefined;

/**
 * Every request is traced. This site serves a handful of people and a handful of
 * trackers rather than general web traffic, so there is no volume worth sampling away —
 * and the trace you discarded is always the one belonging to the tracker that went quiet.
 */
export const SENTRY_TRACES_SAMPLE_RATE = 1;
