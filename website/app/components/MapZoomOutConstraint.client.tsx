import { latLngBounds } from "leaflet";
import { useEffect } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import type { CoordinateBounds } from "./mapPerformance";

export const MapZoomOutConstraint = (props: {
  bounds: CoordinateBounds | undefined;
}) => {
  const map = useMap();

  const enforceZoomOutConstraint = () => {
    if (!props.bounds) {
      return;
    }

    const allowedBounds = latLngBounds(props.bounds);
    const fitZoom = map.getBoundsZoom(allowedBounds, false);

    map.setMinZoom(fitZoom);

    if (map.getZoom() < fitZoom) {
      map.setZoom(fitZoom, { animate: false });
    }
  };

  useMapEvents({
    resize: enforceZoomOutConstraint,
  });

  useEffect(() => {
    enforceZoomOutConstraint();
  });

  return null;
};
