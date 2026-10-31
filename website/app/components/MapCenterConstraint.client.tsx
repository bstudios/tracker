import { latLngBounds } from "leaflet";
import { useEffect, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";

type BoundsTuple = [[number, number], [number, number]];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// Leaflet pans in whole pixels, so a sub-pixel correction can never be
// applied exactly. Treat anything within a pixel as already constrained.
const PIXEL_TOLERANCE = 1;

export const MapCenterConstraint = (props: {
  bounds: BoundsTuple | undefined;
}) => {
  const map = useMap();
  // A non-animated pan fires `moveend` synchronously, which would re-enter
  // this handler. Guard against that to avoid unbounded recursion.
  const isEnforcing = useRef(false);

  const enforceCenterConstraint = () => {
    if (!props.bounds || isEnforcing.current) {
      return;
    }

    const allowedBounds = latLngBounds(props.bounds);
    const currentCenter = map.getCenter();

    const constrainedLat = clamp(
      currentCenter.lat,
      allowedBounds.getSouth(),
      allowedBounds.getNorth(),
    );
    const constrainedLng = clamp(
      currentCenter.lng,
      allowedBounds.getWest(),
      allowedBounds.getEast(),
    );

    if (
      constrainedLat === currentCenter.lat &&
      constrainedLng === currentCenter.lng
    ) {
      return;
    }

    const pixelOffset = map
      .latLngToContainerPoint([constrainedLat, constrainedLng])
      .subtract(map.latLngToContainerPoint(currentCenter));
    if (
      Math.abs(pixelOffset.x) < PIXEL_TOLERANCE &&
      Math.abs(pixelOffset.y) < PIXEL_TOLERANCE
    ) {
      return;
    }

    isEnforcing.current = true;
    try {
      map.panTo([constrainedLat, constrainedLng], {
        animate: false,
      });
    } finally {
      isEnforcing.current = false;
    }
  };

  useMapEvents({
    moveend: enforceCenterConstraint,
    zoomend: enforceCenterConstraint,
  });

  useEffect(() => {
    enforceCenterConstraint();
  });

  return null;
};
