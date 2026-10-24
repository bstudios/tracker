import { z } from "zod";

/**
 * Per-device settings for how a day's raw fixes are condensed into logbook lines.
 *
 * Stored as JSON on `devices.logbook_config`. Every field is optional and a `null` column
 * behaves exactly like `{}`, so a device that has never been configured still produces a
 * sensible log.
 */

export const LOGBOOK_DEFAULT_STATIONARY_RADIUS_METERS = 100;
export const LOGBOOK_DEFAULT_STATIONARY_MINUTES = 15;
export const LOGBOOK_DEFAULT_TIMING_POINT_DWELL_SECONDS = 60;
export const LOGBOOK_DEFAULT_MINIMUM_READINGS = 2;
export const LOGBOOK_DEFAULT_SIGNAL_LOST_MINUTES = 20;
/**
 * Consumer GPS fixes wander by several metres even standing still. A step shorter than
 * this is assumed to be that wander rather than real travel, so it is left out of the
 * cumulative distance total. See `computeCumulativeDistance` in `buildLogbook.ts`.
 */
export const LOGBOOK_DEFAULT_DISTANCE_NOISE_FLOOR_METERS = 20;

const voltageBandSchema = z
  .object({
    /** Shown in the logbook line, e.g. "Charging". */
    name: z.string().min(1).max(60),
    /** Inclusive lower bound. Omit for an open-ended bottom band. */
    min: z.number().optional(),
    /** Exclusive upper bound. Omit for an open-ended top band. */
    max: z.number().optional(),
  })
  .refine(
    (band) => band.min !== undefined || band.max !== undefined,
    "A band needs at least one of min or max",
  )
  .refine(
    (band) =>
      band.min === undefined || band.max === undefined || band.min < band.max,
    "A band's min must be below its max",
  );

const voltageSourceSchema = z.object({
  /** Prefixes the logbook line, e.g. "Engine". */
  label: z.string().min(1).max(60),
  /**
   * SQLite JSON path into `events.data`, e.g. `$.battery.voltage` or
   * `$."other"."external.powersource.voltage"`.
   *
   * A path rather than a fixed field because only the tracker's internal battery lands in
   * the typed `data.battery` object — a boat's engine/input voltage arrives from flespi as
   * an unmapped key under `data.other`, whose shape varies by device. The admin page lists
   * the numeric paths actually present in recent events so this does not have to be
   * guessed.
   */
  jsonPath: z.string().min(1).max(200),
  /**
   * How many consecutive readings in a new band are needed before a line is emitted.
   *
   * This is the hysteresis: a single spurious reading while the alternator settles should
   * not be logged as the engine starting.
   */
  minimumReadings: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(LOGBOOK_DEFAULT_MINIMUM_READINGS),
  bands: z.array(voltageBandSchema).min(1).max(10),
});

const batteryStatusSourceSchema = z
  .object({
    /** Shown on the tracking menu, e.g. "Tracker battery". */
    label: z.string().min(1).max(60),
    /**
     * SQLite JSON path into `events.data` for the reading, e.g. `$.battery.percentage` or
     * `$."other"."battery.voltage"`. The newest event of the day with a value here is used.
     */
    jsonPath: z.string().min(1).max(200),
    /** Printed after the value, e.g. "%" or "V". */
    unit: z.string().max(10).optional(),
    /**
     * The readings that count as empty and full, for the level gauge. Default to 0 and 100
     * when the unit is "%"; with no range at all only the value is shown.
     */
    empty: z.number().optional(),
    full: z.number().optional(),
    /** Readings below this are highlighted as low. */
    lowBelow: z.number().optional(),
    /** Optional JSON path to a boolean (or 0/1) saying whether it is on charge. */
    chargingJsonPath: z.string().min(1).max(200).optional(),
  })
  .refine(
    (source) =>
      source.empty === undefined ||
      source.full === undefined ||
      source.empty !== source.full,
    "A battery source's empty and full readings must differ",
  );

export const logbookConfigSchema = z.compile(z.object({
  stationary: z
    .object({
      /** A run of fixes staying within this distance of its first fix counts as stopped. */
      radiusMeters: z
        .number()
        .min(10)
        .max(5000)
        .default(LOGBOOK_DEFAULT_STATIONARY_RADIUS_METERS),
      /** How long that run must last before it is worth a logbook line. */
      minimumDurationMinutes: z
        .number()
        .min(1)
        .max(1440)
        .default(LOGBOOK_DEFAULT_STATIONARY_MINUTES),
    })
    .default({
      radiusMeters: LOGBOOK_DEFAULT_STATIONARY_RADIUS_METERS,
      minimumDurationMinutes: LOGBOOK_DEFAULT_STATIONARY_MINUTES,
    }),
  signalLost: z
    .object({
      /**
       * A gap this long between two consecutive reports is not evidence the boat stayed
       * put — the tracker went quiet. Logged as "signal lost" / "signal restored" instead
       * of being silently folded into a stationary run.
       */
      afterMinutes: z
        .number()
        .min(1)
        .max(1440)
        .default(LOGBOOK_DEFAULT_SIGNAL_LOST_MINUTES),
    })
    .default({
      afterMinutes: LOGBOOK_DEFAULT_SIGNAL_LOST_MINUTES,
    }),
  timingPointVisit: z
    .object({
      /**
       * Above this dwell the visit is logged as an arrival and a departure; at or below it
       * the visit is a single "passed" line.
       */
      minimumDwellSeconds: z
        .number()
        .min(0)
        .max(86400)
        .default(LOGBOOK_DEFAULT_TIMING_POINT_DWELL_SECONDS),
    })
    .default({
      minimumDwellSeconds: LOGBOOK_DEFAULT_TIMING_POINT_DWELL_SECONDS,
    }),
  voltage: z
    .object({ sources: z.array(voltageSourceSchema).max(5).default([]) })
    .default({ sources: [] }),
  /**
   * Battery readings shown on the tracking menu. Left out, the tracker's own battery is
   * shown (`DEFAULT_BATTERY_STATUS_SOURCES`); an empty list hides the card altogether.
   */
  batteryStatus: z
    .object({ sources: z.array(batteryStatusSourceSchema).max(5) })
    .optional(),
  distance: z
    .object({
      /**
       * A step between two consecutive accepted fixes below this distance is treated as
       * GPS wander, not travel, and is not added to the cumulative distance total. Set to
       * 0 to trust every fix at face value.
       */
      noiseFloorMeters: z
        .number()
        .min(0)
        .max(1000)
        .default(LOGBOOK_DEFAULT_DISTANCE_NOISE_FLOOR_METERS),
    })
    .default({
      noiseFloorMeters: LOGBOOK_DEFAULT_DISTANCE_NOISE_FLOOR_METERS,
    }),
}));

export type LogbookConfig = z.infer<typeof logbookConfigSchema>;
export type LogbookVoltageSource = LogbookConfig["voltage"]["sources"][number];
export type LogbookVoltageBand = LogbookVoltageSource["bands"][number];
export type LogbookBatteryStatusSource = z.infer<
  typeof batteryStatusSourceSchema
>;

/**
 * What the tracking menu shows when `batteryStatus` has never been configured: the
 * tracker's own battery, which every upload maps into the typed `data.battery` object.
 */
export const DEFAULT_BATTERY_STATUS_SOURCES: LogbookBatteryStatusSource[] = [
  {
    label: "Tracker battery",
    jsonPath: "$.battery.percentage",
    unit: "%",
    lowBelow: 20,
    chargingJsonPath: "$.battery.charging",
  },
];

/**
 * Apply defaults to a stored config, treating `null`/`undefined` as "not configured".
 *
 * Throws `z.ZodError` on malformed input so the admin form can report why, rather than
 * silently falling back to defaults and looking like it saved something it did not.
 */
export const parseLogbookConfig = (raw: unknown): LogbookConfig =>
  logbookConfigSchema.parse(raw ?? {});

/** A worked example for the admin page's empty state. */
export const LOGBOOK_CONFIG_EXAMPLE = JSON.stringify(
  {
    stationary: {
      radiusMeters: LOGBOOK_DEFAULT_STATIONARY_RADIUS_METERS,
      minimumDurationMinutes: LOGBOOK_DEFAULT_STATIONARY_MINUTES,
    },
    signalLost: {
      afterMinutes: LOGBOOK_DEFAULT_SIGNAL_LOST_MINUTES,
    },
    timingPointVisit: {
      minimumDwellSeconds: LOGBOOK_DEFAULT_TIMING_POINT_DWELL_SECONDS,
    },
    distance: {
      noiseFloorMeters: LOGBOOK_DEFAULT_DISTANCE_NOISE_FLOOR_METERS,
    },
    voltage: {
      sources: [
        {
          label: "Engine",
          jsonPath: '$."other"."external.powersource.voltage"',
          minimumReadings: LOGBOOK_DEFAULT_MINIMUM_READINGS,
          bands: [
            { name: "Off battery", max: 11.5 },
            { name: "On battery", min: 11.5, max: 13 },
            { name: "Charging", min: 13 },
          ],
        },
      ],
    },
    batteryStatus: {
      sources: [
        {
          label: "Tracker battery",
          jsonPath: "$.battery.percentage",
          unit: "%",
          lowBelow: 20,
          chargingJsonPath: "$.battery.charging",
        },
        {
          label: "Engine battery",
          jsonPath: '$."other"."external.powersource.voltage"',
          unit: "V",
          empty: 11.5,
          full: 12.8,
          lowBelow: 12,
        },
      ],
    },
  },
  null,
  2,
);
