import { MantineProvider, ThemeIcon } from "@mantine/core";
import { divIcon } from "leaflet";
import "leaflet/dist/leaflet.css";
import { DateTime } from "luxon";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";
import { theme } from "~/root";
import {
  createRestrictedViewportBounds,
  mapPerformanceConfig,
} from "../mapPerformance";
import { MapCenterConstraint } from "../MapCenterConstraint.client";
import { MapZoomOutConstraint } from "../MapZoomOutConstraint.client";
import { getSpeedRange, speedToColor } from "./speedColor";

export type AnalysisRoutePoint = {
  id: number;
  timestamp: number;
  latitude: number;
  longitude: number;
  speedMps: number;
};

export type AnalysisRouteSegment = {
  id: string;
  pointId: number;
  timestamp: number;
  timeDeltaSeconds: number;
  distanceMeters: number;
  speedMps: number;
  speedMph: number;
  isStop: boolean;
  positions: [number, number][];
};

const toMillisTimestamp = (rawTimestamp: number) => {
  const absTimestamp = Math.abs(rawTimestamp);

  if (absTimestamp >= 1_000_000_000_000_000) {
    return rawTimestamp / 1000;
  }

  if (absTimestamp >= 1_000_000_000_000) {
    return rawTimestamp;
  }

  return rawTimestamp * 1000;
};

const mapIcon = (children: ReactNode) =>
  divIcon({
    html: renderToStaticMarkup(
      <MantineProvider theme={theme}>{children}</MantineProvider>,
    ),
    iconSize: [20, 20],
    className: "myDivIcon",
  });

export function AnalysisMap(props: {
  points: AnalysisRoutePoint[];
  segments: AnalysisRouteSegment[];
  highlightedPointId?: number | null;
}) {
  const config = mapPerformanceConfig.analysis;

  const speedRange = getSpeedRange(
    props.segments.map((segment) => segment.speedMph),
  );

  const highlightedPoint =
    typeof props.highlightedPointId === "number"
      ? props.points.find((point) => point.id === props.highlightedPointId)
      : null;

  const routeCenter = props.points[0]
    ? ([props.points[0].latitude, props.points[0].longitude] as [
        number,
        number,
      ])
    : ([0, 0] as [number, number]);

  const viewportBounds = createRestrictedViewportBounds(props.points, {
    paddingRatio: config.centerConstraintPaddingRatio,
  });
  const zoomOutBounds = createRestrictedViewportBounds(props.points, {
    paddingRatio: config.zoomOutPaddingRatio,
  });

  return (
    <div style={{ height: 420, width: "100%" }}>
      <MapContainer
        center={routeCenter}
        zoom={13}
        scrollWheelZoom={false}
        touchZoom={true}
        style={{ height: 420, width: "100%", zIndex: 0 }}
        attributionControl={false}
      >
        <MapCenterConstraint bounds={viewportBounds} />
        <MapZoomOutConstraint bounds={zoomOutBounds} />
        <TileLayer
          attribution='Map &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          {...config.tileLayer}
        />
        {props.segments.map((segment) => (
          <Polyline
            key={segment.id}
            positions={segment.positions}
            pathOptions={{
              color: speedToColor(segment.speedMph, speedRange),
              weight: 5,
            }}
          />
        ))}
        {highlightedPoint ? (
          <Marker
            key={`hover-${highlightedPoint.id}`}
            position={[highlightedPoint.latitude, highlightedPoint.longitude]}
            icon={mapIcon(
              <ThemeIcon radius="xl" size="sm" color="red">
                X
              </ThemeIcon>,
            )}
          >
            <Popup>
              {DateTime.fromMillis(
                toMillisTimestamp(highlightedPoint.timestamp),
                {
                  zone: "Europe/London",
                },
              ).toLocaleString(DateTime.DATETIME_MED)}
              <br />
              {(highlightedPoint.speedMps * 2.2369362921).toFixed(1)} mph
            </Popup>
          </Marker>
        ) : null}
      </MapContainer>
    </div>
  );
}
