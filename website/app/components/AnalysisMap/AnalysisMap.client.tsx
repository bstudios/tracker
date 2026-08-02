import { MantineProvider, ThemeIcon } from "@mantine/core";
import { divIcon } from "leaflet";
import "leaflet/dist/leaflet.css";
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
import { formatDateTimeMed } from "~/utils/dateTime";
import { fromMetersPerSecond, SPEED_UNIT_LABELS, type SpeedUnit } from "~/utils/speedUnits";
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
  speedDisplay: number;
  isStop: boolean;
  positions: [number, number][];
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
  speedUnit?: SpeedUnit;
}) {
  const config = mapPerformanceConfig.analysis;
  const speedUnit = props.speedUnit ?? "mph";

  const speedRange = getSpeedRange(
    props.segments.map((segment) => segment.speedDisplay),
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
              color: speedToColor(segment.speedDisplay, speedRange),
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
              {formatDateTimeMed(highlightedPoint.timestamp)}
              <br />
              {fromMetersPerSecond(highlightedPoint.speedMps, speedUnit).toFixed(
                1,
              )}{" "}
              {SPEED_UNIT_LABELS[speedUnit]}
            </Popup>
          </Marker>
        ) : null}
      </MapContainer>
    </div>
  );
}
