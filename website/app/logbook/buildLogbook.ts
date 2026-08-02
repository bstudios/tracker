import { formatDurationBetween, formatTime24 } from "~/utils/dateTime";
import { haversineMeters } from "~/utils/geo";
import type { LogbookConfig } from "./config";
import type { VoltageRun } from "./voltageRuns.server";

/**
 * Condensing a day of GPS fixes into a ship's logbook.
 *
 * A logbook records notable events — where the boat arrived and departed, when it passed a
 * waypoint, when the engine started — not the thousands of individual fixes a tracker
 * reports over a day. This module turns the latter into the former.
 *
 * It is deliberately pure: no database, no React. The logbook page, the print route that
 * the nightly PDF is rendered from, and the email body all build their entries here, so
 * they cannot disagree about what happened.
 */

export type LogbookEvent = {
  /** Unix milliseconds. */
  timestamp: number;
  latitude: number;
  longitude: number;
};

export type LogbookTimingPoint = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  /** Metres. */
  radius: number;
};

export type LogbookEntryKind =
  | "first"
  | "last"
  | "arrived"
  | "departed"
  | "signal-lost"
  | "signal-restored"
  | "timing-point-passed"
  | "timing-point-arrived"
  | "timing-point-departed"
  | "voltage"
  | "remark";

export type LogbookEntry = {
  /** Unix milliseconds. */
  timestamp: number;
  kind: LogbookEntryKind;
  title: string;
  detail?: string;
  latitude?: number;
  longitude?: number;
  /**
   * Set on a stationary arrival that did not happen at a known timing point, carrying the
   * position to offer as a new one. This is what lets the logbook page offer to name a
   * place without the viewer needing admin access.
   */
  nameable?: { latitude: number; longitude: number };
};

/** A run of consecutive fixes that stayed within the stationary radius of each other. */
type StationarySegment = {
  startTimestamp: number;
  endTimestamp: number;
  latitude: number;
  longitude: number;
  /**
   * Why the run stopped extending: the boat actually moved away (`moved`), the tracker
   * went quiet for longer than the signal-lost threshold (`signal-lost`), or the day's
   * data simply ran out while it was still there (`day-end`).
   */
  endedBy: "moved" | "signal-lost" | "day-end";
};

/** A gap between two consecutive reports longer than the signal-lost threshold. */
type SignalGap = {
  lastContactTimestamp: number;
  lastLatitude: number;
  lastLongitude: number;
  resumedTimestamp: number;
  resumedLatitude: number;
  resumedLongitude: number;
};

const formatPosition = (latitude: number, longitude: number) =>
  `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

/**
 * How long a device must have gone quiet before its most recent report is worth calling
 * the "last" of the day, rather than just the latest one so far.
 *
 * Without this, a day in progress shows its most recent ping — received seconds ago — as
 * "Last report of the day", which reads as if tracking has stopped when it plainly hasn't.
 */
const LAST_REPORT_QUIET_THRESHOLD_MS = 20 * 60_000;

/**
 * Find every run of fixes that stayed put for long enough to be worth logging, and every
 * gap between reports long enough to count as the tracker going quiet.
 *
 * A single pass, anchoring on the first fix of a candidate run and extending while each
 * new fix is both within `radiusMeters` of that anchor and reported soon enough after the
 * previous fix. When either check fails, the run is kept if it lasted long enough and a
 * fresh run starts from the fix that broke it.
 *
 * Anchoring on the first fix rather than on a rolling centre means a boat drifting slowly
 * in one direction eventually breaks the run instead of the window creeping along with it,
 * which is the behaviour a logbook wants: dragging an anchor is not staying put.
 *
 * A long silence is treated the same way: a tracker that sleeps and reports twice three
 * hours apart from the same berth is *not* three hours confirmed stopped — it is however
 * long it was actually seen there, followed by a gap that gets its own "signal lost" line
 * rather than being folded silently into the stop.
 */
const findStationarySegments = (
  events: LogbookEvent[],
  radiusMeters: number,
  minimumDurationMinutes: number,
  signalLostAfterMinutes: number,
): { segments: StationarySegment[]; gaps: SignalGap[] } => {
  const minimumDurationMs = minimumDurationMinutes * 60_000;
  const signalLostMs = signalLostAfterMinutes * 60_000;
  const segments: StationarySegment[] = [];
  const gaps: SignalGap[] = [];

  let anchorIndex = 0;

  const flush = (endIndex: number, endedBy: StationarySegment["endedBy"]) => {
    const anchor = events[anchorIndex];
    const last = events[endIndex];
    if (last.timestamp - anchor.timestamp < minimumDurationMs) return;

    // Report the centroid rather than the anchor: it is a better answer to "where was the
    // boat" than whichever fix happened to arrive first, and a better seed for a new
    // timing point.
    const run = events.slice(anchorIndex, endIndex + 1);
    segments.push({
      startTimestamp: anchor.timestamp,
      endTimestamp: last.timestamp,
      latitude: run.reduce((sum, e) => sum + e.latitude, 0) / run.length,
      longitude: run.reduce((sum, e) => sum + e.longitude, 0) / run.length,
      endedBy,
    });
  };

  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const event = events[index];

    if (event.timestamp - previous.timestamp >= signalLostMs) {
      flush(index - 1, "signal-lost");
      gaps.push({
        lastContactTimestamp: previous.timestamp,
        lastLatitude: previous.latitude,
        lastLongitude: previous.longitude,
        resumedTimestamp: event.timestamp,
        resumedLatitude: event.latitude,
        resumedLongitude: event.longitude,
      });
      anchorIndex = index;
      continue;
    }

    const anchor = events[anchorIndex];
    const distance = haversineMeters(
      anchor.latitude,
      anchor.longitude,
      event.latitude,
      event.longitude,
    );

    if (distance > radiusMeters) {
      flush(index - 1, "moved");
      anchorIndex = index;
    }
  }

  if (events.length > 0) flush(events.length - 1, "day-end");

  return { segments, gaps };
};

/** A contiguous run of fixes inside one timing point's radius. */
type TimingPointVisit = {
  timingPoint: LogbookTimingPoint;
  startTimestamp: number;
  endTimestamp: number;
};

/**
 * Find every visit to every timing point, in order.
 *
 * Every visit, not just the first and last of the day: a boat rounding the same headland
 * three times should produce three sets of lines. A device has a handful of timing points,
 * so each fix is simply tested against all of them — the H3 pre-filter the SQL matcher
 * needs is not worth it over an in-memory list this small.
 */
const findTimingPointVisits = (
  events: LogbookEvent[],
  timingPoints: LogbookTimingPoint[],
): TimingPointVisit[] => {
  const visits: TimingPointVisit[] = [];

  for (const timingPoint of timingPoints) {
    let openVisit: TimingPointVisit | null = null;

    for (const event of events) {
      const isInside =
        haversineMeters(
          timingPoint.latitude,
          timingPoint.longitude,
          event.latitude,
          event.longitude,
        ) <= timingPoint.radius;

      if (isInside) {
        if (openVisit) {
          openVisit.endTimestamp = event.timestamp;
        } else {
          openVisit = {
            timingPoint,
            startTimestamp: event.timestamp,
            endTimestamp: event.timestamp,
          };
        }
        continue;
      }

      if (openVisit) {
        visits.push(openVisit);
        openVisit = null;
      }
    }

    if (openVisit) visits.push(openVisit);
  }

  return visits;
};

/**
 * Emit a line each time a voltage source settles into a different band.
 *
 * Input is one entry per *run* of consecutive same-band readings, grouped in SQL — see
 * `voltageRuns.server.ts`. A run shorter than `minimumReadings` is ignored entirely, which
 * is the hysteresis: the momentary dip as a starter motor engages is one or two readings
 * and must not be logged as the engine stopping.
 *
 * The first confirmed run establishes the starting state without emitting a line — the day
 * opening with the engine off is not an event.
 */
const buildVoltageEntries = (
  runs: VoltageRun[],
  config: LogbookConfig,
): LogbookEntry[] => {
  const entries: LogbookEntry[] = [];

  for (const [sourceIndex, source] of config.voltage.sources.entries()) {
    let currentBandName: string | null = null;
    let currentValue: number | null = null;

    const sourceRuns = runs
      .filter((run) => run.sourceIndex === sourceIndex)
      .sort((a, b) => a.startTimestamp - b.startTimestamp);

    for (const run of sourceRuns) {
      if (run.readingCount < source.minimumReadings) continue;
      if (run.bandName === currentBandName) continue;

      if (currentBandName !== null) {
        entries.push({
          // The run's first reading, not the one that confirmed it — that is when the
          // engine actually started.
          timestamp: run.startTimestamp,
          kind: "voltage",
          title: `${source.label}: ${currentBandName} → ${run.bandName}`,
          detail:
            currentValue === null
              ? `${run.startValue.toFixed(1)} V`
              : `${currentValue.toFixed(1)} V → ${run.startValue.toFixed(1)} V`,
        });
      }

      currentBandName = run.bandName;
      currentValue = run.startValue;
    }
  }

  return entries;
};

/**
 * Build the day's logbook.
 *
 * `events` must be for a single device and day, ordered by timestamp ascending.
 */
export function buildLogbook(args: {
  events: LogbookEvent[];
  timingPoints: LogbookTimingPoint[];
  config: LogbookConfig;
  voltageRuns: VoltageRun[];
  /**
   * Unix milliseconds "now", used to decide whether the day's latest report is stale
   * enough yet to call it the "last" of the day. Omit for a day that is already over,
   * where the latest report is always the last one.
   */
  now?: number;
}): LogbookEntry[] {
  const { events, timingPoints, config, voltageRuns, now } = args;
  if (events.length === 0) return [];

  const entries: LogbookEntry[] = [];

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];

  const { segments: stationarySegments, gaps } = findStationarySegments(
    events,
    config.stationary.radiusMeters,
    config.stationary.minimumDurationMinutes,
    config.signalLost.afterMinutes,
  );

  // Time ranges already accounted for by a stationary stop at a named place, per timing
  // point. Stopping inside a timing point's radius otherwise gets picked up twice — once
  // as a stop and once as a visit — and the logbook shows the same arrival on two lines.
  // The stationary segment is the better record of the two: it measures the real dwell
  // rather than however long the boat happened to sit inside the radius.
  const claimedByStop = new Map<number, Array<[number, number]>>();

  // Prefer a known name over coordinates when the boat stopped somewhere already on the
  // chart, and only offer to name the place when it is somewhere new.
  const resolvePlace = (segment: StationarySegment) => {
    const knownPoint = timingPoints.find(
      (timingPoint) =>
        haversineMeters(
          timingPoint.latitude,
          timingPoint.longitude,
          segment.latitude,
          segment.longitude,
        ) <= timingPoint.radius,
    );

    const place =
      knownPoint?.name ?? formatPosition(segment.latitude, segment.longitude);
    const nameable = knownPoint
      ? undefined
      : { latitude: segment.latitude, longitude: segment.longitude };

    if (knownPoint) {
      const claimed = claimedByStop.get(knownPoint.id) ?? [];
      claimed.push([segment.startTimestamp, segment.endTimestamp]);
      claimedByStop.set(knownPoint.id, claimed);
    }

    return { place, nameable };
  };

  // The stop the day opened already sitting in, and the stop it closed still sitting in —
  // if any. Both get folded into the "first"/"last" lines below instead of an adjacent
  // "arrived"/"departed" line, because the day's data simply doesn't say the boat arrived
  // partway through its first stop, nor that it departed its last: it was either already
  // there, or still there when the reports stopped.
  let openingStop: {
    place: string;
    nameable?: { latitude: number; longitude: number };
  } | null = null;
  let closingStop: { place: string; since: number } | null = null;

  for (const segment of stationarySegments) {
    const { place, nameable } = resolvePlace(segment);
    const isOpeningStop = segment.startTimestamp === firstEvent.timestamp;
    const isClosingStop = segment.endedBy === "day-end";

    if (isOpeningStop) {
      openingStop = { place, nameable };
    } else {
      entries.push({
        timestamp: segment.startTimestamp,
        kind: "arrived",
        title: `Arrived at ${place}`,
        latitude: segment.latitude,
        longitude: segment.longitude,
        nameable,
      });
    }

    if (isClosingStop) {
      closingStop = { place, since: segment.startTimestamp };
    } else if (segment.endedBy === "moved") {
      entries.push({
        timestamp: segment.endTimestamp,
        kind: "departed",
        title: `Departed ${place}`,
        detail: `Stopped ${formatDurationBetween(segment.startTimestamp, segment.endTimestamp)}`,
        latitude: segment.latitude,
        longitude: segment.longitude,
      });
    }
    // endedBy "signal-lost" gets no departed line here — the matching gap below already
    // says what actually happened, and it did not depart.
  }

  for (const gap of gaps) {
    entries.push({
      timestamp: gap.lastContactTimestamp,
      kind: "signal-lost",
      title: "Signal lost",
      detail: `No reports received for ${formatDurationBetween(gap.lastContactTimestamp, gap.resumedTimestamp)}`,
      latitude: gap.lastLatitude,
      longitude: gap.lastLongitude,
    });
    entries.push({
      timestamp: gap.resumedTimestamp,
      kind: "signal-restored",
      title: "Signal restored",
      detail: `First report after ${formatDurationBetween(gap.lastContactTimestamp, gap.resumedTimestamp)} without one`,
      latitude: gap.resumedLatitude,
      longitude: gap.resumedLongitude,
    });
  }

  const minimumDwellMs = config.timingPointVisit.minimumDwellSeconds * 1000;

  for (const visit of findTimingPointVisits(events, timingPoints)) {
    const overlapsStop = (claimedByStop.get(visit.timingPoint.id) ?? []).some(
      ([start, end]) =>
        visit.startTimestamp <= end && visit.endTimestamp >= start,
    );
    if (overlapsStop) continue;

    const dwellMs = visit.endTimestamp - visit.startTimestamp;
    const position = {
      latitude: visit.timingPoint.latitude,
      longitude: visit.timingPoint.longitude,
    };

    if (dwellMs <= minimumDwellMs) {
      entries.push({
        timestamp: visit.startTimestamp,
        kind: "timing-point-passed",
        title: `Passed ${visit.timingPoint.name}`,
        ...position,
      });
      continue;
    }

    entries.push({
      timestamp: visit.startTimestamp,
      kind: "timing-point-arrived",
      title: `Arrived at ${visit.timingPoint.name}`,
      ...position,
    });
    entries.push({
      timestamp: visit.endTimestamp,
      kind: "timing-point-departed",
      title: `Departed ${visit.timingPoint.name}`,
      detail: `Stopped ${formatDurationBetween(visit.startTimestamp, visit.endTimestamp)}`,
      ...position,
    });
  }

  entries.push(...buildVoltageEntries(voltageRuns, config));

  entries.push({
    timestamp: firstEvent.timestamp,
    kind: "first",
    title: "First report of the day",
    detail: openingStop
      ? `Already stopped at ${openingStop.place}`
      : formatPosition(firstEvent.latitude, firstEvent.longitude),
    latitude: firstEvent.latitude,
    longitude: firstEvent.longitude,
    nameable: openingStop?.nameable,
  });

  const lastReportIsStale =
    now === undefined ||
    now - lastEvent.timestamp >= LAST_REPORT_QUIET_THRESHOLD_MS;

  if (lastReportIsStale) {
    entries.push({
      timestamp: lastEvent.timestamp,
      kind: "last",
      title: "Last report of the day",
      detail: closingStop
        ? `Stopped at ${closingStop.place} since ${formatTime24(closingStop.since)}`
        : formatPosition(lastEvent.latitude, lastEvent.longitude),
      latitude: lastEvent.latitude,
      longitude: lastEvent.longitude,
    });
  }

  return sortLogbookEntries(entries);
}

/**
 * Chronological order, except the opening and closing lines always bookend the day even
 * when something else shares their timestamp.
 *
 * Exported so callers that splice in entries `buildLogbook` does not know about — currently
 * just free-text remarks, loaded from the database rather than derived from fixes — can
 * re-sort the combined list the same way.
 */
export function sortLogbookEntries(entries: LogbookEntry[]): LogbookEntry[] {
  const rank = (entry: LogbookEntry) =>
    entry.kind === "first" ? -1 : entry.kind === "last" ? 1 : 0;

  return entries.sort(
    (a, b) => rank(a) - rank(b) || a.timestamp - b.timestamp || 0,
  );
}
