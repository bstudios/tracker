import {
  cellToLatLng,
  getHexagonEdgeLengthAvg,
  gridDisk,
  latLngToCell,
} from "h3-js";
import { TIMING_POINT_H3_RESOLUTION } from "../constants/h3";
import { haversineMeters } from "./geo";

/** The H3 cell a position falls in, at the resolution timing point shapes are drawn in. */
export const timingPointCellForLocation = (
  latitude: number,
  longitude: number,
) => latLngToCell(latitude, longitude, TIMING_POINT_H3_RESOLUTION);

/** The centre of a cell, in the shape consumers want a position in. */
export const timingPointLatLng = (cell: string) => {
  const [latitude, longitude] = cellToLatLng(cell);
  return { latitude, longitude };
};

/**
 * The cells that cover a circle: those whose centres lie within `radiusMeters` (plus half a
 * cell edge) of a position.
 *
 * Used to seed a shape from a circle, as when a place is named from the logbook. The cell
 * holding the position itself is always included, so even a radius smaller than a cell
 * yields a usable shape.
 */
export const cellsForCircle = (
  latitude: number,
  longitude: number,
  radiusMeters: number,
) => {
  const centre = timingPointCellForLocation(latitude, longitude);

  // Neighbouring cell centres are `sqrt(3)` edge lengths apart; one extra ring covers the
  // cells that straddle the circle's edge.
  const edge = getHexagonEdgeLengthAvg(TIMING_POINT_H3_RESOLUTION, "m");
  const spacing = edge * Math.sqrt(3);
  // A cell is in if its centre is within half an edge of the circle, so a fix just inside
  // the circle is not lost to the cell it landed in having its centre just outside. Without
  // this, circles around the size of a cell lose most of their matches.
  const reach = radiusMeters + edge / 2;
  const rings = Math.ceil(radiusMeters / spacing) + 1;

  return gridDisk(centre, rings).filter((cell) => {
    if (cell === centre) return true;
    const [cellLatitude, cellLongitude] = cellToLatLng(cell);
    return (
      haversineMeters(latitude, longitude, cellLatitude, cellLongitude) <= reach
    );
  });
};

/**
 * Pick the cell of a shape that sits closest to its centroid, so the single position used
 * for a point's marker is always inside the shape, even a crescent that wraps around it.
 */
export const anchorCellForCells = (cells: readonly string[]) => {
  if (cells.length === 0) {
    throw new Error("A timing point needs at least one cell.");
  }

  const centres = cells.map((cell) => cellToLatLng(cell));
  const meanLatitude =
    centres.reduce((sum, [latitude]) => sum + latitude, 0) / centres.length;
  const meanLongitude =
    centres.reduce((sum, [, longitude]) => sum + longitude, 0) / centres.length;

  let best = cells[0];
  let bestDistance = Infinity;
  centres.forEach(([latitude, longitude], index) => {
    const distance = haversineMeters(
      meanLatitude,
      meanLongitude,
      latitude,
      longitude,
    );
    if (distance < bestDistance) {
      best = cells[index];
      bestDistance = distance;
    }
  });
  return best;
};
