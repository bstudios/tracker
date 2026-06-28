import {
  Button,
  Group,
  List,
  MantineProvider,
  Modal,
  NumberInput,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import { IconPinned, IconTrash } from "@tabler/icons-react";
import { divIcon, type LatLng } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AttributionControl,
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMapEvents,
} from "react-leaflet";
import { useFetcher } from "react-router";
import { theme } from "~/root";
import type { TimingPointEditorProps } from "./TimingPointEditor";

export const MantineProviderWrapper = (props: {
  children: React.ReactNode;
}) => <MantineProvider theme={theme}>{props.children}</MantineProvider>;

const tablerMapIcon = (children: React.ReactNode) =>
  divIcon({
    html: renderToStaticMarkup(
      <MantineProviderWrapper>{children}</MantineProviderWrapper>
    ),
    iconSize: [20, 20],
    className: "myDivIcon",
  });

function NewPointCreator({
  newPoint,
  setNewPoint,
  editorPath,
}: {
  newPoint: LatLng | null;
  setNewPoint: (point: LatLng | null) => void;
  editorPath: string;
}) {
  const fetcher = useFetcher();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      setNewPoint(null);
    }
  }, [fetcher.state, fetcher.data, setNewPoint]);

  useMapEvents({
    click(e) {
      setNewPoint(e.latlng);
    },
  });

  if (newPoint === null) return null;

  return (
    <Modal
      opened={newPoint !== null}
      onClose={() => setNewPoint(null)}
      title="Create new Timing Point"
    >
      <fetcher.Form method="post" action={editorPath}>
        <TextInput
          label="Name"
          placeholder="Enter name for timing point"
          name="name"
          required
        />
        <NumberInput
          label="Radius"
          placeholder="Enter radius in metres"
          name="radius"
          required
          defaultValue={10}
          min={1}
          step={1}
        />
        <input type="hidden" name="latitude" value={newPoint.lat} />
        <input type="hidden" name="longitude" value={newPoint.lng} />
        <Button type="submit" mt="md">
          Create
        </Button>
      </fetcher.Form>
    </Modal>
  );
}

export const TimingPointEditor = (props: TimingPointEditorProps) => {
  const { width, height } = useViewportSize();
  const [newPoint, setNewPoint] = useState<LatLng | null>(null);
  const [editingPoint, setEditingPoint] = useState<
    TimingPointEditorProps["timingPoints"][0] | null
  >(null);
  const fetcher = useFetcher();

  const uniquePins = Object.values(
    props.pins.reduce((acc, pin) => {
      const key = `${pin.latitude.toFixed(7)},${pin.longitude.toFixed(7)}`;
      if (!acc[key] || acc[key].timestamp < pin.timestamp) {
        acc[key] = pin;
      }
      return acc;
    }, {} as Record<string, (typeof props.pins)[0]>)
  );

  if (!width || !height || width === 0 || height === 0)
    return null; // You can only render the map once, subsequent re-renders won't do anything - so we need to wait until we have the viewport size
  else
    return (
      <div style={{ display: "flex", height: height, width: width }}>
        <div style={{ flexGrow: 1 }}>
          <MapContainer
            zoom={13}
            center={[51.505, -0.09]}
            scrollWheelZoom={false}
            style={{
              height: `100%`,
              width: `100%`,
              zIndex: 0,
            }}
            attributionControl={false}
          >
            <NewPointCreator
              newPoint={newPoint}
              setNewPoint={setNewPoint}
              editorPath={props.editorPath}
            />
            <TileLayer
              attribution='Map &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {/*<TileLayer
              url="https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
              maxZoom={20}
              subdomains={["mt1", "mt2", "mt3"]}
              attribution="Map &copy; Google"
            />*/}
            <AttributionControl
              position="bottomright"
              prefix={`
              <a href="https://leafletjs.com" title="A JavaScript library for interactive maps" target="_blank" rel="noopener noreferrer">
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8" class="leaflet-attribution-flag"><path fill="#4C7BE1" d="M0 0h12v4H0z"></path><path fill="#FFD500" d="M0 4h12v3H0z"></path><path fill="#E0BC00" d="M0 7h12v1H0z"></path></svg> Leaflet
              </a>`}
            />
            {props.timingPoints.map((pin, index) => (
              <>
                <Marker
                  key={index}
                  position={[pin.latitude, pin.longitude]}
                  icon={tablerMapIcon(
                    <ThemeIcon radius="xl" size="sm" color="orange">
                      <IconPinned style={{ width: "70%", height: "70%" }} />
                    </ThemeIcon>
                  )}
                >
                  <Popup>
                    <Text>{pin.name}</Text>
                    <Text>Radius: {pin.radius}m</Text>
                    <Text>
                      Applicable Dates:{" "}
                      {pin.applicableDates
                        ? pin.applicableDates.join(", ")
                        : "None"}
                    </Text>
                    <Text>Order: {pin.order}</Text>
                  </Popup>
                </Marker>
                <Circle
                  center={[pin.latitude, pin.longitude]}
                  radius={pin.radius}
                  pathOptions={{ color: "blue" }}
                />
              </>
            ))}
            {uniquePins.length > 0 && (
              <Polyline
                positions={uniquePins.map((pin) => [
                  pin.latitude,
                  pin.longitude,
                ])}
                color={"red"}
                smoothFactor={10}
              />
            )}
            {newPoint && (
              <Marker position={newPoint}>
                <Popup>New Timing Point Location</Popup>
              </Marker>
            )}
          </MapContainer>
        </div>
        <div
          style={{
            width: "300px",
            height: "100%",
            overflowY: "auto",
            padding: "1rem",
          }}
        >
          <List>
            {props.timingPoints.map((point) => (
              <List.Item key={point.id}>
                <Group>
                  <Text>{point.name}</Text>
                  <Button onClick={() => setEditingPoint(point)}>Edit</Button>
                  <fetcher.Form method="delete" action={props.editorPath}>
                    <input type="hidden" name="id" value={point.id} />
                    <Button type="submit" color="red">
                      <IconTrash />
                    </Button>
                  </fetcher.Form>
                </Group>
              </List.Item>
            ))}
          </List>
        </div>
        {editingPoint && (
          <Modal
            opened={editingPoint !== null}
            onClose={() => setEditingPoint(null)}
            title="Edit Timing Point"
          >
            <fetcher.Form method="put" action={props.editorPath}>
              <input type="hidden" name="id" value={editingPoint.id} />
              <TextInput
                label="Name"
                name="name"
                defaultValue={editingPoint.name}
              />
              <NumberInput
                label="Radius"
                name="radius"
                defaultValue={editingPoint.radius}
              />
              <NumberInput
                label="Order"
                name="order"
                defaultValue={editingPoint.order}
              />
              <TextInput
                label="Applicable Dates (comma separated)"
                name="applicableDates"
                defaultValue={
                  editingPoint.applicableDates
                    ? editingPoint.applicableDates.join(",")
                    : ""
                }
              />
              <Button type="submit">Save</Button>
            </fetcher.Form>
          </Modal>
        )}
      </div>
    );
};
