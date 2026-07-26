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

export const logbookConfigSchema = z.object({
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
});

export type LogbookConfig = z.infer<typeof logbookConfigSchema>;
export type LogbookVoltageSource = LogbookConfig["voltage"]["sources"][number];
export type LogbookVoltageBand = LogbookVoltageSource["bands"][number];

/**
 * Apply defaults to a stored config, treating `null`/`undefined` as "not configured".
 *
 * Throws `z.ZodError` on malformed input so the admin form can report why, rather than
 * silently falling back to defaults and looking like it saved something it did not.
 */
export const parseLogbookConfig = (raw: unknown): LogbookConfig =>
  logbookConfigSchema.parse(raw ?? {});

export const LOGBOOK_CONFIG_DEFAULTS: LogbookConfig = parseLogbookConfig({});

/** A worked example for the admin page's empty state. */
export const LOGBOOK_CONFIG_EXAMPLE = JSON.stringify(
  {
    stationary: {
      radiusMeters: LOGBOOK_DEFAULT_STATIONARY_RADIUS_METERS,
      minimumDurationMinutes: LOGBOOK_DEFAULT_STATIONARY_MINUTES,
    },
    timingPointVisit: {
      minimumDwellSeconds: LOGBOOK_DEFAULT_TIMING_POINT_DWELL_SECONDS,
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
  },
  null,
  2,
);

/** The band a reading falls into, or `null` when it is outside every configured band. */
export const bandForVoltage = (
  source: LogbookVoltageSource,
  value: number,
): LogbookVoltageBand | null =>
  source.bands.find(
    (band) =>
      (band.min === undefined || value >= band.min) &&
      (band.max === undefined || value < band.max),
  ) ?? null;
