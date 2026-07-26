import { sql, type SQL } from "drizzle-orm";

const EARTH_RADIUS_METERS = 6371000;

/** Degrees to radians. */
const DEG_TO_RAD = Math.PI / 180;
/** Degrees to *half* radians — the haversine formula halves every delta. */
const HALF_DEG_TO_RAD = Math.PI / 360;

/**
 * Great-circle distance between two points, in metres.
 *
 * Kept in step with `haversineMetersSql` below so that distances computed in the
 * database and distances computed in JS agree.
 */
export const haversineMeters = (
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
) => {
  const halfLatitudeDelta = (toLatitude - fromLatitude) * HALF_DEG_TO_RAD;
  const halfLongitudeDelta = (toLongitude - fromLongitude) * HALF_DEG_TO_RAD;

  const a =
    Math.sin(halfLatitudeDelta) * Math.sin(halfLatitudeDelta) +
    Math.cos(fromLatitude * DEG_TO_RAD) *
      Math.cos(toLatitude * DEG_TO_RAD) *
      Math.sin(halfLongitudeDelta) *
      Math.sin(halfLongitudeDelta);

  return EARTH_RADIUS_METERS * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
};

/**
 * The same haversine, as a SQLite expression.
 *
 * SQLite has no trigonometric helpers beyond the basics, so the constants are pre-baked
 * rather than derived: `0.00872664626` is π/360 and `0.01745329252` is π/180. `MIN(1.0, ...)`
 * guards against floating point pushing the argument of `ASIN` above 1 for coincident points.
 */
export const haversineMetersSql = (
  fromLatitude: SQL.Aliased<number> | SQL<number>,
  fromLongitude: SQL.Aliased<number> | SQL<number>,
  toLatitude: SQL.Aliased<number> | SQL<number>,
  toLongitude: SQL.Aliased<number> | SQL<number>,
): SQL<number> => sql<number>`(${EARTH_RADIUS_METERS * 2} * ASIN(MIN(1.0, SQRT(
  SIN((${fromLatitude} - ${toLatitude}) * 0.00872664626) *
  SIN((${fromLatitude} - ${toLatitude}) * 0.00872664626) +
  COS(${toLatitude} * 0.01745329252) *
  COS(${fromLatitude} * 0.01745329252) *
  SIN((${fromLongitude} - ${toLongitude}) * 0.00872664626) *
  SIN((${fromLongitude} - ${toLongitude}) * 0.00872664626)
))))`;
