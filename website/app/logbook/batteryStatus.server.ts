import type { DrizzleD1Database } from "drizzle-orm/d1";
import { and, desc, eq, sql } from "drizzle-orm";
import * as Schema from "~/database/schema.d";
import {
  DEFAULT_BATTERY_STATUS_SOURCES,
  parseLogbookConfig,
  type LogbookBatteryStatusSource,
} from "./config";

export type BatteryStatusReading = {
  label: string;
  value: number;
  unit: string | null;
  /** 0–100 position between the configured empty and full readings, or null with no range. */
  level: number | null;
  isLow: boolean;
  /** null when no charging path is configured or the event did not report one. */
  charging: boolean | null;
  timestamp: number;
};

/**
 * Which readings to show for a device, tolerating a config that no longer matches the
 * schema — the admin page is where a bad config gets reported, not the tracking menu.
 */
const readSources = (raw: unknown): LogbookBatteryStatusSource[] => {
  try {
    return (
      parseLogbookConfig(raw).batteryStatus?.sources ??
      DEFAULT_BATTERY_STATUS_SOURCES
    );
  } catch {
    return DEFAULT_BATTERY_STATUS_SOURCES;
  }
};

/** SQLite's `json_extract` hands booleans back as 0/1; some devices send strings instead. */
const toCharging = (raw: unknown): boolean | null => {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const normalised = raw.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalised)) return true;
    if (["false", "0", "no", "off"].includes(normalised)) return false;
  }
  return null;
};

const toLevel = (source: LogbookBatteryStatusSource, value: number) => {
  const isPercent = source.unit === "%";
  const empty = source.empty ?? (isPercent ? 0 : undefined);
  const full = source.full ?? (isPercent ? 100 : undefined);
  if (empty === undefined || full === undefined) return null;
  const level = ((value - empty) / (full - empty)) * 100;
  return Math.min(100, Math.max(0, level));
};

/**
 * The most recent reading of the day for each configured battery source.
 *
 * Each source is looked up separately because devices do not report every field in every
 * message — the latest event may carry a position but no engine voltage.
 */
export async function loadBatteryStatus(
  db: DrizzleD1Database<typeof Schema>,
  args: { deviceId: number; dateString: string },
): Promise<BatteryStatusReading[]> {
  const { deviceId, dateString } = args;

  const [device] = await db
    .select({ logbookConfig: Schema.Devices.logbookConfig })
    .from(Schema.Devices)
    .where(eq(Schema.Devices.id, deviceId))
    .limit(1);
  const sources = readSources(device?.logbookConfig);

  const readings = await Promise.all(
    sources.map(async (source) => {
      const value = sql<unknown>`json_extract(${Schema.Events.data}, ${source.jsonPath})`;
      const charging = source.chargingJsonPath
        ? sql<unknown>`json_extract(${Schema.Events.data}, ${source.chargingJsonPath})`
        : sql<null>`NULL`;

      const [row] = await db
        .select({ value, charging, timestamp: Schema.Events.timestamp })
        .from(Schema.Events)
        .where(
          and(
            eq(Schema.Events.deviceId, deviceId),
            eq(Schema.Events.dateString, dateString),
            sql`${value} IS NOT NULL`,
          ),
        )
        .orderBy(desc(Schema.Events.timestamp))
        .limit(1);

      const numericValue = Number(row?.value);
      if (!row || row.value === "" || !Number.isFinite(numericValue)) {
        return null;
      }

      return {
        label: source.label,
        value: numericValue,
        unit: source.unit ?? null,
        level: toLevel(source, numericValue),
        isLow: source.lowBelow !== undefined && numericValue < source.lowBelow,
        charging: toCharging(row.charging),
        timestamp: row.timestamp,
      } satisfies BatteryStatusReading;
    }),
  );

  return readings.filter((reading) => reading !== null);
}
