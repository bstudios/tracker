import { Button, Group, MantineProvider, Text, ThemeIcon } from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import {
  IconBike,
  IconBeerFilled,
  IconBrandApple,
  IconBus,
  IconBrandGoogleMaps,
  IconCar,
  IconCoffee,
  IconCompass,
  IconCurrentLocation,
  IconGasStationFilled,
  IconHelicopter,
  IconMotorbike,
  IconPlane,
  IconPinned,
  IconRefresh,
  IconSailboat,
  IconShip,
  IconSpeedboat,
  IconTrain,
  IconTrainFilled,
  IconTruck,
} from "@tabler/icons-react";
import { DivIcon, divIcon, LatLng } from "leaflet";
import "leaflet/dist/leaflet.css";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AttributionControl,
  LayerGroup,
  LayersControl,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { Link, useRevalidator } from "react-router";
import { DEFAULT_DEVICE_ICON } from "~/constants/deviceIcons";
import { theme } from "~/root";
import {
  createRestrictedViewportBounds,
  mapPerformanceConfig,
} from "../mapPerformance";
import { MapCenterConstraint } from "../MapCenterConstraint.client";
import { MapZoomOutConstraint } from "../MapZoomOutConstraint.client";
import type { MapProps } from "./LiveMap";

export const MantineProviderWrapper = (props: {
  children: React.ReactNode;
}) => <MantineProvider theme={theme}>{props.children}</MantineProvider>;

const tablerMapIcon = (children: React.ReactNode) =>
  divIcon({
    html: renderToStaticMarkup(
      <MantineProviderWrapper>{children}</MantineProviderWrapper>,
    ),
    iconSize: [20, 20],
    className: "myDivIcon",
  });

const getDeviceIcon = (iconName: string | null) => {
  switch (iconName ?? DEFAULT_DEVICE_ICON) {
    case "IconTruck":
      return <IconTruck style={{ width: "70%", height: "70%" }} />;
    case "IconBike":
      return <IconBike style={{ width: "70%", height: "70%" }} />;
    case "IconMotorbike":
      return <IconMotorbike style={{ width: "70%", height: "70%" }} />;
    case "IconBus":
      return <IconBus style={{ width: "70%", height: "70%" }} />;
    case "IconTrain":
      return <IconTrain style={{ width: "70%", height: "70%" }} />;
    case "IconSpeedboat":
      return <IconSpeedboat style={{ width: "70%", height: "70%" }} />;
    case "IconSailboat":
      return <IconSailboat style={{ width: "70%", height: "70%" }} />;
    case "IconShip":
      return <IconShip style={{ width: "70%", height: "70%" }} />;
    case "IconPlane":
      return <IconPlane style={{ width: "70%", height: "70%" }} />;
    case "IconHelicopter":
      return <IconHelicopter style={{ width: "70%", height: "70%" }} />;
    case "IconCar":
    default:
      return <IconCar style={{ width: "70%", height: "70%" }} />;
  }
};

const ReCentreButton = (props: {
  lat: number;
  lon: number;
  zoom: number | undefined;
}) => {
  const map = useMap();
  return (
    <Button
      onClick={() => map.setView(new LatLng(props.lat, props.lon), props.zoom)}
    >
      <IconCurrentLocation />
    </Button>
  );
};
const RefreshButton = () => {
  const revalidator = useRevalidator();
  return (
    <Button onClick={() => revalidator.revalidate()}>
      <IconRefresh />
    </Button>
  );
};
const ThisUserCurrentLocation = (props: { icon: DivIcon }) => {
  const [position, setPosition] = useState<LatLng | null>(null);
  const map = useMapEvents({
    click() {
      map.locate();
    },
    locationfound(e) {
      setPosition(e.latlng);
    },
  });
  return position === null ? null : (
    <Marker position={position} icon={props.icon} zIndexOffset={900}>
      <Popup>Your location</Popup>
    </Marker>
  );
};

const PreventPagePinchZoom = () => {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const preventDefault = (event: Event) => event.preventDefault();
    const preventDefaultWhenPinching = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };
    const preventBrowserZoomOnTrackpadPinch = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
      }
    };

    container.addEventListener("gesturestart", preventDefault);
    container.addEventListener("gesturechange", preventDefault);
    container.addEventListener("gestureend", preventDefault);
    container.addEventListener("touchstart", preventDefaultWhenPinching, {
      passive: false,
    });
    container.addEventListener("touchmove", preventDefaultWhenPinching, {
      passive: false,
    });
    container.addEventListener("wheel", preventBrowserZoomOnTrackpadPinch, {
      passive: false,
    });

    return () => {
      container.removeEventListener("gesturestart", preventDefault);
      container.removeEventListener("gesturechange", preventDefault);
      container.removeEventListener("gestureend", preventDefault);
      container.removeEventListener("touchstart", preventDefaultWhenPinching);
      container.removeEventListener("touchmove", preventDefaultWhenPinching);
      container.removeEventListener("wheel", preventBrowserZoomOnTrackpadPinch);
    };
  }, [map]);

  return null;
};

export const Map = (props: MapProps) => {
  const revalidator = useRevalidator();
  const config = mapPerformanceConfig.live;

  useEffect(() => {
    const intervalId = setInterval(() => revalidator.revalidate(), 60 * 1000); // Refresh the page for new data every minute
    return () => clearInterval(intervalId);
  }, [revalidator]);

  const { width, height } = useViewportSize();
  if (!props.pins || props.pins.length === 0) {
    return <Text>No data</Text>;
  }

  const uniquePins = Object.values(
    props.pins.reduce(
      (acc, pin) => {
        const key = `${pin.latitude.toFixed(7)},${pin.longitude.toFixed(7)}`;
        if (!acc[key] || acc[key].timestamp < pin.timestamp) {
          acc[key] = pin;
        }
        return acc;
      },
      {} as Record<string, (typeof props.pins)[0]>,
    ),
  );

  const highestTimestampPin = props.pins.reduce((maxPin, currentPin) => {
    return currentPin.timestamp > maxPin.timestamp ? currentPin : maxPin;
  }, props.pins[0]);

  const groupedTimingPoints = props.timingPoints.reduce(
    (acc, timingPoint) => {
      const groupName = timingPoint.group ?? "Other Timing Points";
      if (!acc[groupName]) acc[groupName] = [];
      acc[groupName].push(timingPoint);
      return acc;
    },
    {} as Record<string, Array<(typeof props.timingPoints)[number]>>,
  );

  const viewportBounds = useMemo(
    () =>
      createRestrictedViewportBounds(
        [
          ...props.pins,
          ...props.timingPoints.map((timingPoint) => ({
            latitude: timingPoint.latitude,
            longitude: timingPoint.longitude,
          })),
        ],
        { paddingRatio: config.centerConstraintPaddingRatio },
      ),
    [config.centerConstraintPaddingRatio, props.pins, props.timingPoints],
  );

  const zoomOutBounds = useMemo(
    () =>
      createRestrictedViewportBounds(
        [
          ...props.pins,
          ...props.timingPoints.map((timingPoint) => ({
            latitude: timingPoint.latitude,
            longitude: timingPoint.longitude,
          })),
        ],
        { paddingRatio: config.zoomOutPaddingRatio },
      ),
    [config.zoomOutPaddingRatio, props.pins, props.timingPoints],
  );

  if (!width || !height || width === 0 || height === 0)
    return null; // You can only render the map once, subsequent re-renders won't do anything - so we need to wait until we have the viewport size
  else
    return (
      <div style={{ height: height, width: width }}>
        <MapContainer
          center={[highestTimestampPin.latitude, highestTimestampPin.longitude]}
          zoom={props.zoom}
          scrollWheelZoom={true}
          touchZoom={true}
          style={{
            height: `${height}px`,
            width: `${width}px`,
            zIndex: 0,
            touchAction: "none",
          }}
          attributionControl={false}
        >
          <PreventPagePinchZoom />
          <MapCenterConstraint bounds={viewportBounds} />
          <MapZoomOutConstraint bounds={zoomOutBounds} />
          <TileLayer
            attribution='Map &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            {...config.tileLayer}
          />
          <AttributionControl
            position="bottomright"
            prefix={`
              <a href="/${props.password}/${props.urlDate}">
                Back to menu
              </a>&nbsp;|&nbsp;
              <a href="https://leafletjs.com" title="A JavaScript library for interactive maps" target="_blank" rel="noopener noreferrer">
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8" class="leaflet-attribution-flag"><path fill="#4C7BE1" d="M0 0h12v4H0z"></path><path fill="#FFD500" d="M0 4h12v3H0z"></path><path fill="#E0BC00" d="M0 7h12v1H0z"></path></svg> Leaflet
              </a>`}
          />
          <ThisUserCurrentLocation
            icon={tablerMapIcon(
              <ThemeIcon radius="md" size="lg">
                <IconCompass style={{ width: "70%", height: "70%" }} />
              </ThemeIcon>,
            )}
          />
          <Marker
            position={[
              highestTimestampPin.latitude,
              highestTimestampPin.longitude,
            ]}
            zIndexOffset={1000}
            icon={tablerMapIcon(
              <ThemeIcon radius="md" size="lg">
                {getDeviceIcon(props.deviceIcon)}
              </ThemeIcon>,
            )}
          >
            <Popup>
              <Text>
                {(() => {
                  const now = DateTime.now();
                  const lastSeen = DateTime.fromSeconds(
                    highestTimestampPin.timestamp / 1000,
                    {
                      zone: "local",
                    },
                  );
                  // Only show if last seen is today and less than 12 hours ago
                  if (
                    now.hasSame(lastSeen, "day") &&
                    now.diff(lastSeen, "hours").hours < 12
                  ) {
                    return (
                      <>
                        Tracker last seen {lastSeen.toRelative()}
                        <br />
                      </>
                    );
                  }
                  return null;
                })()}
                {DateTime.fromSeconds(highestTimestampPin.timestamp / 1000, {
                  zone: "Europe/London",
                }).toLocaleString(DateTime.DATETIME_MED)}
              </Text>
              <Link
                to={`https://www.google.com/maps?q=${highestTimestampPin.latitude},${highestTimestampPin.longitude}`}
                target="_blank"
              >
                <Button
                  size="xs"
                  mb="xs"
                  rightSection={
                    <IconBrandGoogleMaps
                      style={{ width: "70%", height: "70%" }}
                    />
                  }
                >
                  Open location in Google Maps
                </Button>
              </Link>
              <Link
                to={`https://maps.apple.com/?q=${highestTimestampPin.latitude},${highestTimestampPin.longitude}`}
                target="_blank"
              >
                <Button
                  size="xs"
                  rightSection={
                    <IconBrandApple style={{ width: "70%", height: "70%" }} />
                  }
                >
                  Open location in Apple Maps
                </Button>
              </Link>
            </Popup>
          </Marker>
          <LayersControl position="bottomleft">
            {Object.entries(groupedTimingPoints).map(([groupName, points]) => (
              <LayersControl.Overlay
                name={groupName}
                key={groupName}
                checked={true}
              >
                <LayerGroup>
                  {points.map((timingPoint, index) => (
                    <Marker
                      key={`${groupName}-${index}`}
                      position={[timingPoint.latitude, timingPoint.longitude]}
                      icon={tablerMapIcon(
                        <ThemeIcon radius="xl" size="sm" color="orange">
                          {timingPoint.icon === "IconBeer" ? (
                            <IconBeerFilled
                              style={{ width: "70%", height: "70%" }}
                            />
                          ) : timingPoint.icon === "IconCoffee" ? (
                            <IconCoffee
                              style={{ width: "70%", height: "70%" }}
                            />
                          ) : timingPoint.icon === "IconGasStation" ? (
                            <IconGasStationFilled
                              style={{ width: "70%", height: "70%" }}
                            />
                          ) : timingPoint.icon === "IconTrain" ? (
                            <IconTrainFilled
                              style={{ width: "70%", height: "70%" }}
                            />
                          ) : (
                            <IconPinned
                              style={{ width: "70%", height: "70%" }}
                            />
                          )}
                        </ThemeIcon>,
                      )}
                    >
                      <Popup>
                        <Text>{timingPoint.name}</Text>
                        <Link
                          to={
                            timingPoint.googleLink ??
                            `https://www.google.com/maps?q=${timingPoint.latitude},${timingPoint.longitude}`
                          }
                          target="_blank"
                        >
                          <Button
                            size="xs"
                            mb="xs"
                            rightSection={
                              <IconBrandGoogleMaps
                                style={{ width: "70%", height: "70%" }}
                              />
                            }
                          >
                            Open location in Google Maps
                          </Button>
                        </Link>
                        <Link
                          to={`https://maps.apple.com/?q=${timingPoint.latitude},${timingPoint.longitude}`}
                          target="_blank"
                        >
                          <Button
                            size="xs"
                            rightSection={
                              <IconBrandApple
                                style={{ width: "70%", height: "70%" }}
                              />
                            }
                          >
                            Open location in Apple Maps
                          </Button>
                        </Link>
                      </Popup>
                    </Marker>
                  ))}
                </LayerGroup>
              </LayersControl.Overlay>
            ))}
            <LayersControl.Overlay name="History" checked={true}>
              <Polyline
                positions={uniquePins.map((pin) => [
                  pin.latitude,
                  pin.longitude,
                ])}
                color={"red"}
                smoothFactor={10}
              />
            </LayersControl.Overlay>
          </LayersControl>
          <div className="leaflet-top leaflet-right">
            <div className="leaflet-control leaflet-bar">
              <Group>
                <ReCentreButton
                  lat={highestTimestampPin.latitude}
                  lon={highestTimestampPin.longitude}
                  zoom={props.zoom}
                />
                <RefreshButton />
              </Group>
            </div>
          </div>
        </MapContainer>
      </div>
    );
};
