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

export type AnalysisRoutePoint = {
  id: number;
  timestamp: number;
  latitude: number;
  longitude: number;
  speed: number;
};

export type AnalysisRouteSegment = {
  id: string;
  timestamp: number;
  timeDeltaSeconds: number;
  speedMph: number;
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

const speedColor = (speedMph: number) => {
  if (speedMph < 1) return "#7c3aed";
  if (speedMph < 12) return "#2563eb";
  if (speedMph < 31) return "#16a34a";
  if (speedMph < 50) return "#f59e0b";
  return "#dc2626";
};

export function AnalysisMap(props: {
  points: AnalysisRoutePoint[];
  segments: AnalysisRouteSegment[];
  highlightedPointId?: number | null;
}) {
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
        <TileLayer
          attribution='Map &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {props.segments.map((segment) => (
          <Polyline
            key={segment.id}
            positions={segment.positions}
            pathOptions={{
              color: speedColor(segment.speedMph),
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
              {DateTime.fromSeconds(highlightedPoint.timestamp / 1000, {
                zone: "Europe/London",
              }).toLocaleString(DateTime.DATETIME_MED)}
              <br />
              {(highlightedPoint.speed * 2.2369362921).toFixed(1)} mph
            </Popup>
          </Marker>
        ) : null}
      </MapContainer>
    </div>
  );
}
