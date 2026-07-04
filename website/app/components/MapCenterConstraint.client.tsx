import { latLngBounds } from "leaflet";
import { useEffect } from "react";
import { useMap, useMapEvents } from "react-leaflet";

type BoundsTuple = [[number, number], [number, number]];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const approximatelyEqual = (a: number, b: number, epsilon = 1e-8) =>
  Math.abs(a - b) < epsilon;

export const MapCenterConstraint = (props: {
  bounds: BoundsTuple | undefined;
}) => {
  const map = useMap();

  const enforceCenterConstraint = () => {
    if (!props.bounds) {
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
      approximatelyEqual(constrainedLat, currentCenter.lat) &&
      approximatelyEqual(constrainedLng, currentCenter.lng)
    ) {
      return;
    }

    map.panTo([constrainedLat, constrainedLng], {
      animate: false,
    });
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
