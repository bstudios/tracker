# Tracker

A tracking system for vehicles, which works by creating a log for a given date for each device. It can accept data from:

- The Expo app `app/`
- Devices compatible with Traccar, using the Traccar forwarding endpoint defined in XML on the Traccar server (powered by 1NCE SIM cards)
- Devices compatible with flespi, using a flespi HTTP stream

These devices are generally powered by 1NCE SIM cards.

It uses a D1 database to store events, and a simple React Router 7 website to view them. The frontend website is in two logical halves:

- A daily tracking section, which essentially acts as a logbook
- An event tracking section, for trackers used at events (such as running races, cycling events, etc.). This is more intended for people to view the location of a device in real time, and see where it has been.

The logic for each is quite different, however as they share so many components they run on the same codebase. The website is in the `website/` folder.

All times shown in the UI are rendered in `Europe/London` (see `DISPLAY_TIME_ZONE` in `website/app/utils/dateTime.ts`). Days are always UTC: `events.date_string` buckets by UTC day and `/:password/:date` means that UTC day, so a summer log for a given date runs 01:00 to 00:59 local.

## Logbook

`/:password/:date/logbook` condenses a day's position reports into the lines a ship's logbook carries — first and last report, arrivals and departures, timing points passed, and engine/charge changes — rather than one line per fix. Previous/next skip to the nearest day that actually has data.

Stops and voltage bands are configured per device under **Admin → Devices → Logbook**. Leaving the config blank uses the defaults (stopped = 15 minutes within 100 m, no voltage lines). Voltage sources are addressed by JSON path into `events.data` because only the tracker's internal battery has a fixed field — engine/input voltage arrives as an unmapped flespi key under `data.other`. That admin page lists the numeric paths the device has actually reported so they can be copied rather than guessed.

Anyone with the viewing password can name a stop, which creates a timing point at that position. Editing or deleting it afterwards needs admin access.

### Daily email

If a device has email recipients set on that same admin page, the `daily-logbook-email` Workflow runs at 00:05 UTC, renders the previous UTC day's logbook to a PDF with Browser Rendering, and emails it to each recipient. Devices with no recipients, or with no events that day, are skipped.

The schedule lives on the Workflow binding in `wrangler.jsonc` (`schedules`), not as a worker cron trigger.

Rendered PDFs for finished days are kept in the `R2_BUCKET` R2 bucket, so a day is only ever rendered once — whichever of the nightly email or the page's **Download PDF** link comes first warms the cache for the other. Today's log is never cached, because it is still growing; the download link only appears once the UTC day has ended. Deleting an object from the bucket simply causes it to be re-rendered on next request, so the bucket is safe to prune.

Nothing on a schedule ever deletes from the bucket — neither the nightly Workflow nor the deploy Action touches an existing object. Archived copies are dropped only when an edit makes them disagree with what the page would now render, by `invalidateLogbookArchive` (the whole of one device's archive, for changes that rewrite every past day: timing points, logbook config, the device name, the display distance unit) or `invalidateLogbookArchiveDay` (one day, for a remark). If the bucket looks emptier than the number of days that have passed, that is where to look first — followed by any object lifecycle rule set on the bucket in the Cloudflare dashboard, which lives outside this repository.

Setup that cannot be done from the repository:

- Onboard the sender domain (`EMAIL_FROM` in `wrangler.jsonc`) in Cloudflare Email Sending. The zone must use Cloudflare DNS.
- Make sure the Cloudflare Access policy is scoped to `/admin` and not the whole zone, or Browser Rendering cannot fetch `/print/logbook/...`.

For local development, put the secret in `website/.dev.vars` (gitignored):

```
PDF_SIGNING_SECRET=local-development-secret
```

The `BROWSER` and `EMAIL` bindings are deliberately **not** marked `"remote": true`, because that would make every `npm run dev` require Cloudflare credentials. Neither has a working local simulator, so to exercise the workflow end to end run `npx wrangler dev --remote`.

## Error monitoring, logs and traces

Everything reports into one Sentry project, from two independent paths.

**The Sentry SDK**, wired up in the application itself, reports what the application knows:
which route matched, which D1 query ran, which loader threw. It covers three places —
`workers/app.ts` wraps the `fetch` handler and the nightly Workflow class,
`app/entry.server.tsx` names the request span after the matched route and captures server
errors, and `app/entry.client.tsx` initialises the browser SDK. `app/utils/sentry.ts` holds
the settings both halves share; `app/utils/sentry.server.ts` builds the worker's options.

**The Cloudflare OpenTelemetry export**, configured under `observability` in
`wrangler.jsonc`, reports what the Workers runtime itself records about every invocation —
including ones that never reach application code. The `destinations` names there
(`sentry-traces-project-tracker`, `sentry-logs-project-tracker`) refer to exporters
configured in the Cloudflare dashboard, under **Workers & Pages → Observability →
Destinations**. Those are account-level and live outside this repository; if they ever need
recreating, the settings are:

|               | Traces                                                                               | Logs                                                                               |
| ------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Type          | Traces                                                                               | Logs                                                                               |
| OTLP endpoint | `https://o83272.ingest.us.sentry.io/api/4512129566900224/integration/otlp/v1/traces` | `https://o83272.ingest.us.sentry.io/api/4512129566900224/integration/otlp/v1/logs` |
| Custom header | `x-sentry-auth: sentry sentry_key=1683d0b8a14e80e1bd464fb23d62e450`                  | same                                                                               |

Deleting a destination in the dashboard without removing its name from `wrangler.jsonc`
will fail the deploy, and vice versa the name is the only thing tying the two together.

### What is and is not sent

URLs are sent to Sentry as they are. The viewing password is the first path segment of
nearly every URL here, so it reaches Sentry with them — on the request URL, on span and
transaction names, and on breadcrumbs. That is a deliberate choice: it keeps traces
readable and lets an error be traced back to the exact page someone was on. Treat access to
the Sentry project as equivalent to holding every viewing password.

Cookies, request bodies and user identity are switched off in `dataCollection` on both
sides — the admin session is a Cloudflare Access JWT, and the login form posts the viewing
password. Session Replay is not enabled.

Logs are Sentry's structured logs (`enableLogs`). On the worker, `console.log`/`warn`/
`error` are piped through as well, so the calls already scattered through the upload
endpoints and the logbook Workflow show up in Sentry as well as the Workers dashboard. On
the browser they are not, because the console there is mostly React's and Leaflet's.

### Local development

Sentry is off in development: `SENTRY_ENABLED` is `import.meta.env.PROD`, so `npm run dev`
reports nothing and needs no configuration. There is nothing to put in `.dev.vars` — the
DSN is a constant in `app/utils/sentry.ts` rather than a binding, because it is not a
secret and the browser bundle needs it too.

### Source maps

`npm run build` produces no source maps unless `SENTRY_AUTH_TOKEN` is set, which keeps a
local build identical to what it was before Sentry existed. When it is set, the build
generates them, uploads them to Sentry, then deletes the browser half — `build/client/` is
served verbatim as the site's static assets, so a `.map` left there would be a public copy
of the source. The worker's maps are deliberately kept so that `wrangler deploy` can upload
them to Cloudflare too (`upload_source_maps` in `wrangler.jsonc`), which un-minifies stack
traces in the Workers dashboard as well.

Stack traces resolve by debug id, which is stamped into each bundle and its map, so this
works whether or not the release lines up. The release is the commit SHA, set by
`SENTRY_RELEASE` in the deploy workflow and baked into both bundles so the running code
reports the same string the maps were uploaded under. The Cloudflare version id — which
names the deploy rather than the commit — is attached to every worker event as the
`cloudflare_version` tag.

The deploy needs three things set on the repository, and skips the upload without them:
`SENTRY_AUTH_TOKEN` as an Actions secret, and `SENTRY_ORG` and `SENTRY_PROJECT` as Actions
variables.

## Tracking Devices

### Expo App

The Expo app is a simple app in the app/ folder which uploads location data to the server. It is designed to be run on a device with a GPS chip, such as a phone or tablet.

### SinoTrack Devices

[ST-915L](/.github/SinoTrack%20ST915L-E.pdf)

`RCONF` command

```
ST915/4G,ID:[ID Redacted],PW:0000,U1:,U2:,U3:,MODE:GPRS-MOVE,DAILY:OFF,GEO FENCE:OFF,OVER SPEED:OFF,VOICE:OFF,SHAKE ALARM:OFF,SLEEP:ON,APN:iot.1nce.net,,,IP:FLESPI URL]:[FLESPI IP],GPRS UPLOAD TIME:30s,TIME ZONE:0.0
```

### ST-901 Device

[ST-901L](./.github/SinoTrack%20ST901L.pdf)

`RCONF` command

```
ST-901/4G,ID:[ID Redacted],PW:0000,U1:,U2:,U3:,MODE:GPRS,POWER ALARM:OFF,ACCSMS:OFF,ACCCALL:OFF,GEO FENCE:OFF,OVER SPEED:OFF,VOICE:OFF,SHAKE ALARM:OFF,SLEEP:OFF,APN:iot.1nce.net,,,IP:[FLESPI URL]:[FLESPI IP],GPRS UPLOAD TIME 1:20,GPRS UPLOAD TIME 2:20,TIME ZONE:0.0
```

### ST909 Device

The device uses H02 protocol (port 5013)
You can SMS the device using https://portal.1nce.com/portal/customer/dashboard

To set a new address send a message saying `IP,10.10.10.10,5013` (replacing 10.10.10.10 with the IP of the traccar/flespi server)

Default address is `IP,27.aika168.com,8185`

![Device manual](/.github/manual-page1.jpg)
![Device manual](/.github/manual-page2.jpg)
![Device manual](/.github/manual-page3.jpg)

From a similar device online:

![Device Commands](/.github/device-commands-screenshot-1.png)
![Device Commands](/.github/device-commands-screenshot-2.png)

## Forwarders

### Traccar

You can use [traccar](https://github.com/traccar/traccar) as the intermediary for tracking devices with different protocols.

#### Setup Traccar forwarding

Stored in `/opt/traccar/conf/traccar.xml` on the traccar server.

<entry key='forward.enable'>true</entry>
<entry key='forward.type'>url</entry>
<entry key='forward.url'>https://[URL GOES HERE]/upload-traccar.json?name={name}&amp;status={status}&amp;deviceId={deviceId}&amp;protocol={protocol}&amp;deviceTime={deviceTime}&amp;fixTime={fixTime}&amp;valid={valid}&amp;latitude={latitude}&amp;longitude={longitude}&amp;altitude={altitude}&amp;speed={speed}&amp;course={course}&amp;accuracy={accuracy}&amp;statusCode={statusCode}</entry>
<entry key='forward.retry.enable'>true</entry>
<entry key='forward.retry.delay'>10000</entry>
<entry key='forward.retry.count'>1000</entry>
<entry key='forward.retry.limit'>1000</entry>
<entry key='event.forward.url'>https://[URL GOES HERE]/upload-traccar.json</entry>
<entry key='event.forward.type'>json</entry>

### flespi

For flespi HTTP streams, send `POST` requests to:

`https://[URL GOES HERE]/upload-flespi.json`

The endpoint accepts flespi message payloads as a single JSON object, an array of message objects, or wrapped in `result`, `messages`, or `data`.

It reads location and timestamp fields from either dot-notation keys (`position.latitude`) or nested objects (`position.latitude`) and stores them in the same events table used by other upload endpoints.
