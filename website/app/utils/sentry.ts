/**
 * The parts of the Sentry setup that both halves of the app have to agree on.
 *
 * The browser and the worker report into the same Sentry project, so the DSN, the sample
 * rate and the redaction rules live here rather than being written out twice in
 * `entry.client.tsx` and `workers/app.ts`.
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

/**
 * Top-level path segments that are real routes rather than a viewing password.
 *
 * Everything else at the root of the site is `/:password/...` (see `app/routes.ts`), and
 * passwords match `^[a-z0-9-]+$`, so a first segment containing a dot — `favicon.ico`,
 * `upload-flespi.json`, an `assets/` bundle filename — is never a password either.
 */
const RESERVED_FIRST_SEGMENTS = new Set(["admin", "assets", "print"]);

/** Query parameters whose value is a credential or carries a password inside it. */
const REDACTED_QUERY_PARAMS = new Set([
  // HMAC that lets the nightly Workflow render `/print/logbook/...` without a session.
  "token",
  // React Router's `/__manifest` request lists the paths it wants, passwords and all.
  "p",
]);

const REDACTED = "[redacted]";

/** Only ever used so that a root-relative path can be parsed; never part of the result. */
const PARSE_BASE = "https://redacted.invalid";

/**
 * The hosts whose first path segment is a viewing password.
 *
 * Keep in step with `PUBLIC_BASE_URL` in `wrangler.jsonc`. Everywhere else — an
 * OpenStreetMap tile at `/12/2045/1362.png`, anything else the app fetches — the first
 * segment means something to that server and is not a credential here, so rewriting it
 * would only make the outgoing span harder to read.
 */
const OWN_HOSTS = new Set(["tracker.bithell.studio", "localhost", "127.0.0.1"]);

/**
 * Strip viewing passwords and signed tokens out of a URL.
 *
 * Nearly every URL on this site starts with the viewing password — `/:password/:date` is
 * the shape of the whole logbook and tracking section — so URLs reach Sentry carrying a
 * working credential unless they are rewritten first. Sentry's own `dataCollection`
 * filtering only covers headers, cookies and query parameters, and this password is in
 * the path, so it has to be handled here.
 *
 * Accepts absolute URLs and root-relative paths alike, because span attributes use both.
 * Anything else is returned untouched — `new URL` will happily read an arbitrary sentence
 * as a relative path and hand back a percent-encoded travesty of it, so what is and is not
 * a URL has to be decided before parsing rather than by catching a throw.
 */
export const redactSensitiveUrl = (value: string): string => {
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  if (!isAbsolute && !value.startsWith("/")) return value;

  let url: URL;
  try {
    // The base is only there so that a root-relative path parses; it is dropped again below.
    url = new URL(value, PARSE_BASE);
  } catch {
    return value;
  }

  const segments = url.pathname.split("/");
  // `pathname` always starts with "/", so segments[0] is "" and the first real segment is
  // at index 1.
  const firstSegment = segments[1];
  if (
    (!isAbsolute || OWN_HOSTS.has(url.hostname)) &&
    firstSegment &&
    /^[a-z0-9-]+$/.test(firstSegment) &&
    !RESERVED_FIRST_SEGMENTS.has(firstSegment)
  ) {
    segments[1] = REDACTED;
    url.pathname = segments.join("/");
  }

  for (const param of REDACTED_QUERY_PARAMS) {
    if (url.searchParams.has(param)) url.searchParams.set(param, REDACTED);
  }

  return isAbsolute
    ? url.toString()
    : `${url.pathname}${url.search}${url.hash}`;
};

/**
 * HTTP span names are `"<METHOD> <url>"` rather than a bare URL, so the verb has to be
 * lifted off before the rest is treated as one. Anything not in that shape is passed
 * straight to {@link redactSensitiveUrl}, which leaves non-URLs alone.
 */
const redactSensitiveSpanName = (name: string): string => {
  const [verb, ...rest] = name.split(" ");
  if (verb && rest.length === 1 && /^[A-Z]{3,7}$/.test(verb)) {
    return `${verb} ${redactSensitiveUrl(rest[0] as string)}`;
  }
  return redactSensitiveUrl(name);
};

/**
 * Span and breadcrumb attributes whose value is a URL or a path.
 *
 * Sentry and OpenTelemetry disagree on the spelling depending on where a span came from —
 * a fetch span uses `url.full`, the incoming request span uses `http.url` — so both
 * vocabularies are listed rather than guessed at.
 */
const URL_ATTRIBUTES = [
  "url",
  "url.full",
  "url.path",
  "http.url",
  "http.target",
  "http.route",
  "from",
  "to",
] as const;

type AttributeBag = Record<string, unknown> | undefined;

const redactAttributes = (data: AttributeBag) => {
  if (!data) return;
  for (const key of URL_ATTRIBUTES) {
    const value = data[key];
    if (typeof value === "string") data[key] = redactSensitiveUrl(value);
  }
};

/** The parts of a Sentry event that can carry a URL, described structurally. */
type RedactableEvent = {
  transaction?: string;
  request?: { url?: string };
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
  spans?: Array<{ description?: string; data?: Record<string, unknown> }>;
  contexts?: { trace?: { data?: Record<string, unknown> } };
  exception?: {
    values?: Array<{ mechanism?: { data?: Record<string, unknown> } }>;
  };
};

/**
 * Rewrite every URL an event carries, in place.
 *
 * Wired into `beforeSend` and `beforeSendTransaction` on both the client and the worker.
 * It mutates rather than clones because a Sentry event is a deep, loosely typed object and
 * a partial copy would be a reliable way to quietly drop fields we never knew about.
 */
export const redactSensitiveEventUrls = <T extends RedactableEvent>(
  event: T,
): T => {
  if (event.request?.url) {
    event.request.url = redactSensitiveUrl(event.request.url);
  }
  // Both sides name transactions after the parameterised route, but a span that starts
  // before the route is known is named after the raw URL instead.
  if (event.transaction) {
    event.transaction = redactSensitiveSpanName(event.transaction);
  }
  redactAttributes(event.contexts?.trace?.data);
  for (const breadcrumb of event.breadcrumbs ?? []) {
    redactAttributes(breadcrumb.data);
  }
  for (const span of event.spans ?? []) {
    if (span.description)
      span.description = redactSensitiveSpanName(span.description);
    redactAttributes(span.data);
  }
  // React Router's client instrumentation records the URL it failed on as mechanism data.
  for (const value of event.exception?.values ?? []) {
    redactAttributes(value.mechanism?.data);
  }
  return event;
};

/** The same treatment for a standalone span, which is sent outside any event. */
export const redactSensitiveSpanUrls = <
  T extends { description?: string; data?: Record<string, unknown> },
>(
  span: T,
): T => {
  if (span.description)
    span.description = redactSensitiveSpanName(span.description);
  redactAttributes(span.data);
  return span;
};
