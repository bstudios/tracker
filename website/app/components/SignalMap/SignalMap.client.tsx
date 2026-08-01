import "leaflet/dist/leaflet.css";
import { cellToBoundary } from "h3-js";
import type { ReactNode } from "react";
import { MapContainer, Polygon, Popup, TileLayer } from "react-leaflet";
import {
  createRestrictedViewportBounds,
  mapPerformanceConfig,
} from "../mapPerformance";
import { MapCenterConstraint } from "../MapCenterConstraint.client";
import { MapZoomOutConstraint } from "../MapZoomOutConstraint.client";

export type HexCell = {
  h3Index: string;
  latitude: number;
  longitude: number;
  color: string;
  popup: ReactNode;
};

export function SignalMap(props: { cells: HexCell[] }) {
  const config = mapPerformanceConfig.signal;

  const mapCenter = props.cells[0]
    ? ([props.cells[0].latitude, props.cells[0].longitude] as [number, number])
    : ([0, 0] as [number, number]);

  const viewportBounds = createRestrictedViewportBounds(props.cells, {
    paddingRatio: config.centerConstraintPaddingRatio,
  });
  const zoomOutBounds = createRestrictedViewportBounds(props.cells, {
    paddingRatio: config.zoomOutPaddingRatio,
  });

  return (
    <div style={{ height: 420, width: "100%" }}>
      <MapContainer
        center={mapCenter}
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
        {props.cells.map((cell) => (
          <Polygon
            key={cell.h3Index}
            positions={cellToBoundary(cell.h3Index)}
            pathOptions={{
              color: cell.color,
              fillColor: cell.color,
              fillOpacity: 0.6,
              weight: 1,
            }}
          >
            <Popup>{cell.popup}</Popup>
          </Polygon>
        ))}
      </MapContainer>
    </div>
  );
}
