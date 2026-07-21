import { latLngToCell } from "h3-js";
import { H3_RESOLUTION } from "~/constants/h3";

export const toUtcDateString = (timestampMs: number) =>
  new Date(timestampMs).toISOString().slice(0, 10);

export const getH3IndexForLocation = (
  latitude: number,
  longitude: number,
  resolution = H3_RESOLUTION,
) => latLngToCell(latitude, longitude, resolution);
