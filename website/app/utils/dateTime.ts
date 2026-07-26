import { DateTime } from "luxon";

/**
 * Every time-of-day shown in the UI is rendered in this zone.
 *
 * It is deliberately a fixed zone rather than the viewer's device zone: the site is
 * server rendered, and the nightly logbook PDF is rendered by a headless browser with no
 * meaningful local zone at all. Pinning the zone keeps the server HTML, the hydrated
 * client HTML and the PDF byte-identical.
 *
 * Note this is a *display* concern only. Timestamps are stored as unix milliseconds and
 * `events.date_string` buckets days in UTC — see `toUtcDateString` in `~/utils/h3`.
 */
export const DISPLAY_TIME_ZONE = "Europe/London";

/**
 * Coerce a stored timestamp to unix milliseconds.
 *
 * Uploads have not always agreed on units — some legacy rows are in seconds and some in
 * microseconds — so magnitude is used to work out which. Anything at or above ~1e15 is
 * microseconds, at or above ~1e12 is already milliseconds, and anything smaller is seconds.
 */
export const toMillisTimestamp = (rawTimestamp: number) => {
  const absTimestamp = Math.abs(rawTimestamp);

  if (absTimestamp >= 1_000_000_000_000_000) {
    return rawTimestamp / 1000;
  }

  if (absTimestamp >= 1_000_000_000_000) {
    return rawTimestamp;
  }

  return rawTimestamp * 1000;
};

/** A stored timestamp as a luxon `DateTime` in the display zone. */
export const displayDateTime = (rawTimestamp: number) =>
  DateTime.fromMillis(toMillisTimestamp(rawTimestamp), {
    zone: DISPLAY_TIME_ZONE,
  });

/** e.g. `28 Jun 2026, 14:32` */
export const formatDateTimeMed = (rawTimestamp: number) =>
  displayDateTime(rawTimestamp).toLocaleString(DateTime.DATETIME_MED);

/** e.g. `14:32` */
export const formatTime24 = (rawTimestamp: number) =>
  displayDateTime(rawTimestamp).toLocaleString(DateTime.TIME_24_SIMPLE);

/** e.g. `14:32:07` */
export const formatTime24WithSeconds = (rawTimestamp: number) =>
  displayDateTime(rawTimestamp).toLocaleString(DateTime.TIME_24_WITH_SECONDS);

/** e.g. `28 Jun 2026, 14:32:07` — used for chart tooltips. */
export const formatDateTimeWithSeconds = (rawTimestamp: number) =>
  displayDateTime(rawTimestamp).toFormat("dd LLL yyyy, HH:mm:ss");

/**
 * Format a `YYYY-MM-DD` UTC day bucket for display.
 *
 * Takes the string rather than a `DateTime` on purpose: parsing a UTC-midnight ISO string
 * without an explicit zone reinterprets it in the runtime's zone, which can render the
 * previous day. The day bucket is already the value we want to show, so there is no need
 * to round-trip it through a date at all.
 */
export const formatUtcDay = (dayString: string) => dayString;

/**
 * A human duration between two stored timestamps, e.g. `2h 14m`, `47m`, `35s`.
 *
 * Durations under a minute are shown in seconds so that brief timing-point passages do
 * not all collapse to "0m".
 */
export const formatDurationBetween = (
  fromRawTimestamp: number,
  toRawTimestamp: number,
) => {
  const millis = Math.max(
    0,
    toMillisTimestamp(toRawTimestamp) - toMillisTimestamp(fromRawTimestamp),
  );

  const totalSeconds = Math.round(millis / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
};
