import { haversineMeters } from "~/utils/geo";
import { bandForVoltage, type LogbookConfig } from "./config";

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
  id: number;
  /** Unix milliseconds. */
  timestamp: number;
  latitude: number;
  longitude: number;
  /** Reading per configured voltage source, keyed by the source's `jsonPath`. */
  voltages?: Record<string, number | null>;
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
  | "timing-point-passed"
  | "timing-point-arrived"
  | "timing-point-departed"
  | "voltage";

export type LogbookEntry = {
  /** Unix milliseconds. */
  timestamp: number;
  kind: LogbookEntryKind;
  title: string;
  detail?: string;
  latitude?: number;
  longitude?: number;
  timingPointId?: number;
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
};

const formatPosition = (latitude: number, longitude: number) =>
  `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

/**
 * Find every run of fixes that stayed put for long enough to be worth logging.
 *
 * A single pass, anchoring on the first fix of a candidate run and extending while each
 * new fix is still within `radiusMeters` of that anchor. When one escapes, the run is kept
 * if it lasted long enough and a fresh run starts from the escaping fix.
 *
 * Anchoring on the first fix rather than on a rolling centre means a boat drifting slowly
 * in one direction eventually breaks the run instead of the window creeping along with it,
 * which is the behaviour a logbook wants: dragging an anchor is not staying put.
 *
 * Note this measures position, not speed, so a tracker that sleeps and reports twice three
 * hours apart from the same berth is correctly read as three hours stopped.
 */
export const findStationarySegments = (
  events: LogbookEvent[],
  radiusMeters: number,
  minimumDurationMinutes: number,
): StationarySegment[] => {
  const minimumDurationMs = minimumDurationMinutes * 60_000;
  const segments: StationarySegment[] = [];

  let anchorIndex = 0;

  const flush = (endIndex: number) => {
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
    });
  };

  for (let index = 1; index < events.length; index += 1) {
    const anchor = events[anchorIndex];
    const event = events[index];
    const distance = haversineMeters(
      anchor.latitude,
      anchor.longitude,
      event.latitude,
      event.longitude,
    );

    if (distance > radiusMeters) {
      flush(index - 1);
      anchorIndex = index;
    }
  }

  if (events.length > 0) flush(events.length - 1);

  return segments;
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
export const findTimingPointVisits = (
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
 * A change is only reported once the new band has held for `minimumReadings` consecutive
 * readings, so the momentary dip as a starter motor engages does not get logged as the
 * engine stopping. Fixes missing the reading are skipped rather than treated as a change,
 * because a tracker that omits the field for one message has not told us anything.
 *
 * The first band seen establishes the starting state without emitting a line — the day
 * opening with the engine off is not an event.
 */
const buildVoltageEntries = (
  events: LogbookEvent[],
  config: LogbookConfig,
): LogbookEntry[] => {
  const entries: LogbookEntry[] = [];

  for (const source of config.voltage.sources) {
    let currentBandName: string | null = null;
    let currentValue: number | null = null;
    let pendingBandName: string | null = null;
    let pendingCount = 0;
    let pendingFirstEvent: LogbookEvent | null = null;
    let pendingFirstValue: number | null = null;

    for (const event of events) {
      const value = event.voltages?.[source.jsonPath];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;

      const band = bandForVoltage(source, value);
      if (!band) continue;

      if (band.name === currentBandName) {
        currentValue = value;
        pendingBandName = null;
        pendingCount = 0;
        continue;
      }

      if (band.name !== pendingBandName) {
        pendingBandName = band.name;
        pendingCount = 1;
        pendingFirstEvent = event;
        pendingFirstValue = value;
      } else {
        pendingCount += 1;
      }

      if (pendingCount < source.minimumReadings) continue;

      // Report the transition at the reading that first showed it, not at the one that
      // confirmed it — that is when the engine actually started.
      const at = pendingFirstEvent ?? event;
      const newValue = pendingFirstValue ?? value;

      if (currentBandName !== null) {
        entries.push({
          timestamp: at.timestamp,
          kind: "voltage",
          title: `${source.label}: ${currentBandName} → ${band.name}`,
          detail:
            currentValue === null
              ? `${newValue.toFixed(1)} V`
              : `${currentValue.toFixed(1)} V → ${newValue.toFixed(1)} V`,
          latitude: at.latitude,
          longitude: at.longitude,
        });
      }

      currentBandName = band.name;
      currentValue = value;
      pendingBandName = null;
      pendingCount = 0;
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
}): LogbookEntry[] {
  const { events, timingPoints, config } = args;
  if (events.length === 0) return [];

  const entries: LogbookEntry[] = [];

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];

  entries.push({
    timestamp: firstEvent.timestamp,
    kind: "first",
    title: "First report of the day",
    detail: formatPosition(firstEvent.latitude, firstEvent.longitude),
    latitude: firstEvent.latitude,
    longitude: firstEvent.longitude,
  });

  const stationarySegments = findStationarySegments(
    events,
    config.stationary.radiusMeters,
    config.stationary.minimumDurationMinutes,
  );

  // Time ranges already accounted for by a stationary stop at a named place, per timing
  // point. Stopping inside a timing point's radius otherwise gets picked up twice — once
  // as a stop and once as a visit — and the logbook shows the same arrival on two lines.
  // The stationary segment is the better record of the two: it measures the real dwell
  // rather than however long the boat happened to sit inside the radius.
  const claimedByStop = new Map<number, Array<[number, number]>>();

  for (const segment of stationarySegments) {
    // Prefer a known name over coordinates when the boat stopped somewhere already on the
    // chart, and only offer to name the place when it is somewhere new.
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

    entries.push({
      timestamp: segment.startTimestamp,
      kind: "arrived",
      title: `Arrived at ${place}`,
      latitude: segment.latitude,
      longitude: segment.longitude,
      timingPointId: knownPoint?.id,
      nameable,
    });

    entries.push({
      timestamp: segment.endTimestamp,
      kind: "departed",
      title: `Departed ${place}`,
      latitude: segment.latitude,
      longitude: segment.longitude,
      timingPointId: knownPoint?.id,
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
      timingPointId: visit.timingPoint.id,
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
      ...position,
    });
  }

  entries.push(...buildVoltageEntries(events, config));

  entries.push({
    timestamp: lastEvent.timestamp,
    kind: "last",
    title: "Last report of the day",
    detail: formatPosition(lastEvent.latitude, lastEvent.longitude),
    latitude: lastEvent.latitude,
    longitude: lastEvent.longitude,
  });

  // Chronological, but the opening and closing lines always bookend the day even when
  // something else shares their timestamp.
  const rank = (entry: LogbookEntry) =>
    entry.kind === "first" ? -1 : entry.kind === "last" ? 1 : 0;

  return entries.sort(
    (a, b) => rank(a) - rank(b) || a.timestamp - b.timestamp || 0,
  );
}
