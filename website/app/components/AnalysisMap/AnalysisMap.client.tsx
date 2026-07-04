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
  speedKph: number;
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

const speedColor = (speedKph: number) => {
  if (speedKph < 1) return "#7c3aed";
  if (speedKph < 20) return "#2563eb";
  if (speedKph < 50) return "#16a34a";
  if (speedKph < 80) return "#f59e0b";
  return "#dc2626";
};

export function AnalysisMap(props: {
  points: AnalysisRoutePoint[];
  segments: AnalysisRouteSegment[];
}) {
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
              color: speedColor(segment.speedKph),
              weight: 5,
            }}
          />
        ))}
        {props.points.map((point, index) => (
          <Marker
            key={`${point.id}-${index}`}
            position={[point.latitude, point.longitude]}
            icon={mapIcon(
              <ThemeIcon radius="xl" size="sm" color="pink">
                {index === 0
                  ? "S"
                  : index === props.points.length - 1
                    ? "F"
                    : "•"}
              </ThemeIcon>,
            )}
          >
            <Popup>
              {DateTime.fromSeconds(point.timestamp / 1000, {
                zone: "Europe/London",
              }).toLocaleString(DateTime.DATETIME_MED)}
              <br />
              {(point.speed * 3.6).toFixed(1)} km/h
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
