import {
  Button,
  Group,
  List,
  MantineProvider,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import { IconPinned, IconTrash } from "@tabler/icons-react";
import {
  cellsToMultiPolygon,
  cellToBoundary,
  latLngToCell,
  polygonToCells,
  uncompactCells,
} from "h3-js";
import {
  canvas,
  circle as leafletCircle,
  divIcon,
  layerGroup,
  polygon as leafletPolygon,
  type LatLng,
  type Polygon as LeafletPolygon,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AttributionControl,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { useFetcher } from "react-router";
import { TIMING_POINT_H3_RESOLUTION } from "~/constants/h3";
import { theme } from "~/root";
import { cellsForCircle } from "~/utils/timingPointShape";
import type {
  EditorTimingPoint,
  TimingPointEditorProps,
} from "./TimingPointEditor";

/** Below this zoom the cells are too small to pick out, so the grid is not drawn. */
const MIN_SHAPE_EDIT_ZOOM = 17;
/** Stops a very wide window at the minimum zoom from drawing an unusable number of cells. */
const MAX_GRID_CELLS = 6000;

const SELECTED_STYLE = {
  color: "#e8590c",
  weight: 1,
  fillColor: "#fd7e14",
  fillOpacity: 0.55,
};
const UNSELECTED_STYLE = {
  color: "#868e96",
  weight: 1,
  fillColor: "#868e96",
  fillOpacity: 0.05,
};

/**
 * The cell grid for the part of the map in view, with the cells of the shape being edited
 * highlighted. The grid is built by hand with Leaflet rather than as React elements:
 * thousands of polygons restyled on every click would be far too slow to re-render.
 *
 * The selection lives in `selectionRef` so painting across the map never waits on React.
 */
function ShapeEditLayer({
  selectionRef,
  revision,
  paintMode,
  brushRadius,
  anchor,
  onSelectionChange,
  onGridAvailable,
}: {
  selectionRef: React.MutableRefObject<Set<string>>;
  /** Bumped whenever the parent replaces the selection wholesale. */
  revision: number;
  paintMode: boolean;
  /** Metres around the cursor that one paint stroke covers. */
  brushRadius: number;
  anchor: [number, number];
  onSelectionChange: (size: number) => void;
  onGridAvailable: (available: boolean) => void;
}) {
  const map = useMap();
  const polygons = useRef(new Map<string, LeafletPolygon>());
  const paintModeRef = useRef(paintMode);
  paintModeRef.current = paintMode;
  const brushRadiusRef = useRef(brushRadius);
  brushRadiusRef.current = brushRadius;

  // With the grid hidden (zoomed out), the selection is drawn as an outline instead, so
  // the shape being edited never disappears. Redrawn at most every 100ms: outlining a
  // large shape is too slow to do on every mouse move while painting.
  const gridVisibleRef = useRef(false);
  const outlineRef = useRef<LeafletPolygon | null>(null);
  const outlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawOutline = () => {
    outlineTimer.current = null;
    outlineRef.current?.setLatLngs(
      gridVisibleRef.current || selectionRef.current.size === 0
        ? []
        : cellsToMultiPolygon([...selectionRef.current], false),
    );
  };
  const scheduleOutline = () => {
    if (gridVisibleRef.current || outlineTimer.current) return;
    outlineTimer.current = setTimeout(drawOutline, 100);
  };

  /** Returns whether the selection changed; callers report the new size once they are done. */
  const setCell = (cell: string, selected: boolean) => {
    const selection = selectionRef.current;
    if (selection.has(cell) === selected) return false;
    if (selected) selection.add(cell);
    else selection.delete(cell);
    polygons.current
      .get(cell)
      ?.setStyle(selected ? SELECTED_STYLE : UNSELECTED_STYLE);
    scheduleOutline();
    return true;
  };

  const restyle = () => {
    for (const [cell, polygon] of polygons.current) {
      polygon.setStyle(
        selectionRef.current.has(cell) ? SELECTED_STYLE : UNSELECTED_STYLE,
      );
    }
  };

  useEffect(() => {
    map.setView(anchor, Math.max(map.getZoom(), 18));
    // Only on starting to edit — not whenever the anchor changes after a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const renderer = canvas({ padding: 0.5 });
    const group = layerGroup().addTo(map);
    const outline = leafletPolygon([], {
      ...SELECTED_STYLE,
      weight: 2,
      fillOpacity: 0.35,
      interactive: false,
    }).addTo(map);
    outlineRef.current = outline;

    const rebuild = () => {
      group.clearLayers();
      polygons.current.clear();

      if (map.getZoom() < MIN_SHAPE_EDIT_ZOOM) {
        gridVisibleRef.current = false;
        onGridAvailable(false);
        drawOutline();
        return;
      }

      const bounds = map.getBounds();
      const cells = polygonToCells(
        [
          [bounds.getSouth(), bounds.getWest()],
          [bounds.getNorth(), bounds.getWest()],
          [bounds.getNorth(), bounds.getEast()],
          [bounds.getSouth(), bounds.getEast()],
        ],
        TIMING_POINT_H3_RESOLUTION,
      );
      if (cells.length > MAX_GRID_CELLS) {
        gridVisibleRef.current = false;
        onGridAvailable(false);
        drawOutline();
        return;
      }

      gridVisibleRef.current = true;
      drawOutline();
      onGridAvailable(true);
      for (const cell of cells) {
        const polygon = leafletPolygon(cellToBoundary(cell), {
          renderer,
          bubblingMouseEvents: false,
          ...(selectionRef.current.has(cell)
            ? SELECTED_STYLE
            : UNSELECTED_STYLE),
        });
        polygon.on("click", () => {
          if (paintModeRef.current) return;
          setCell(cell, !selectionRef.current.has(cell));
          onSelectionChange(selectionRef.current.size);
        });
        polygon.addTo(group);
        polygons.current.set(cell, polygon);
      }
    };

    rebuild();
    map.on("moveend", rebuild);
    return () => {
      map.off("moveend", rebuild);
      group.remove();
      outline.remove();
      outlineRef.current = null;
      if (outlineTimer.current) clearTimeout(outlineTimer.current);
      polygons.current.clear();
    };
    // `setCell` only closes over refs and a stable callback prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    restyle();
    drawOutline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  // Painting: dragging a brush across the map sets every cell under it the way the cell
  // first touched was not. Leaflet's own drag-to-pan has to be switched off for the
  // duration or the map slides about.
  useEffect(() => {
    if (!paintMode) return;
    map.dragging.disable();

    const brush = leafletCircle(map.getCenter(), {
      radius: brushRadiusRef.current,
      interactive: false,
      color: "#e8590c",
      weight: 1,
      dashArray: "4",
      fill: false,
    });

    let painting: boolean | null = null; // The state being painted: selected or not.
    let lastCell: string | null = null;
    const paint = (latlng: LatLng) => {
      const cell = latLngToCell(
        latlng.lat,
        latlng.lng,
        TIMING_POINT_H3_RESOLUTION,
      );
      // A stroke moves a few pixels at a time, mostly staying inside one cell.
      if (cell === lastCell) return;
      lastCell = cell;

      if (painting === null) painting = !selectionRef.current.has(cell);
      let changed = false;
      for (const brushed of cellsForCircle(
        latlng.lat,
        latlng.lng,
        brushRadiusRef.current,
      )) {
        changed = setCell(brushed, painting) || changed;
      }
      if (changed) onSelectionChange(selectionRef.current.size);
    };
    const onDown = (event: { latlng: LatLng }) => {
      painting = null;
      lastCell = null;
      paint(event.latlng);
    };
    const onMove = (event: { latlng: LatLng }) => {
      brush.setLatLng(event.latlng).setRadius(brushRadiusRef.current);
      if (!map.hasLayer(brush)) brush.addTo(map);
      if (painting !== null) paint(event.latlng);
    };
    const stop = () => {
      painting = null;
    };
    const leave = () => {
      stop();
      brush.remove();
    };

    map.on("mousedown", onDown);
    map.on("mousemove", onMove);
    map.on("mouseup", stop);
    map.getContainer().addEventListener("mouseleave", leave);
    return () => {
      map.dragging.enable();
      map.off("mousedown", onDown);
      map.off("mousemove", onMove);
      map.off("mouseup", stop);
      map.getContainer().removeEventListener("mouseleave", leave);
      brush.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, paintMode]);

  return null;
}

/** Draws each saved shape as a single outline, holes included, rather than cell by cell. */
const shapeOutline = (cells: string[]) =>
  cellsToMultiPolygon(uncompactCells(cells, TIMING_POINT_H3_RESOLUTION), false);

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
  devices,
  disabled,
}: {
  disabled: boolean;
  newPoint: LatLng | null;
  setNewPoint: (point: LatLng | null) => void;
  editorPath: string;
  devices: TimingPointEditorProps["devices"];
}) {
  const fetcher = useFetcher();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      setNewPoint(null);
    }
  }, [fetcher.state, fetcher.data, setNewPoint]);

  useMapEvents({
    click(e) {
      if (!disabled) setNewPoint(e.latlng);
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
        <Select
          label="Device"
          placeholder="Select the device this timing point belongs to"
          name="deviceId"
          required
          defaultValue={devices[0] ? String(devices[0].id) : null}
          data={devices.map((device) => ({
            value: String(device.id),
            label: device.name,
          }))}
        />
        <NumberInput
          label="Starting radius"
          description="The shape starts as a circle this wide — adjust it cell by cell afterwards"
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
  const [editingPoint, setEditingPoint] = useState<EditorTimingPoint | null>(
    null,
  );
  const fetcher = useFetcher();

  // Reshaping a point. The selection itself is in a ref, see `ShapeEditLayer`; the state
  // here is only what the controls need to show.
  const shapeFetcher = useFetcher();
  const [shapeEditing, setShapeEditing] = useState<EditorTimingPoint | null>(
    null,
  );
  const selectionRef = useRef(new Set<string>());
  const [selectionSize, setSelectionSize] = useState(0);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [paintMode, setPaintMode] = useState(false);
  const [gridAvailable, setGridAvailable] = useState(false);
  const [brushRadius, setBrushRadius] = useState<number | string>(25);
  const [circleRadius, setCircleRadius] = useState<number | string>(40);

  const outlines = useMemo(
    () =>
      new Map(
        props.timingPoints.map((point) => [point.id, shapeOutline(point.cells)]),
      ),
    [props.timingPoints],
  );
  const cellCount = (point: EditorTimingPoint) =>
    uncompactCells(point.cells, TIMING_POINT_H3_RESOLUTION).length;

  const startShapeEdit = (point: EditorTimingPoint) => {
    selectionRef.current = new Set(
      uncompactCells(point.cells, TIMING_POINT_H3_RESOLUTION),
    );
    setSelectionSize(selectionRef.current.size);
    setSelectionRevision((revision) => revision + 1);
    setPaintMode(false);
    setShapeEditing(point);
  };

  const replaceSelection = (cells: string[]) => {
    selectionRef.current = new Set(cells);
    setSelectionSize(selectionRef.current.size);
    setSelectionRevision((revision) => revision + 1);
  };

  const shapeSaving = shapeFetcher.state !== "idle";
  useEffect(() => {
    if (shapeFetcher.state === "idle" && shapeFetcher.data) {
      setShapeEditing(null);
    }
  }, [shapeFetcher.state, shapeFetcher.data]);

  // Offer the badges already used on a device's points, so they stay spelt the same.
  const badgesForDevice = (deviceId: number) =>
    Array.from(
      new Set(
        props.timingPoints
          .filter((point) => point.deviceId === deviceId)
          .flatMap((point) => point.badges),
      ),
    ).sort();

  const deviceNameById = (deviceId: number) =>
    props.devices.find((device) => device.id === deviceId)?.name ?? "Unknown";

  const uniquePins = Object.values(
    props.pins.reduce((acc, pin) => {
      const key = `${pin.latitude.toFixed(7)},${pin.longitude.toFixed(7)}`;
      if (!acc[key] || acc[key].timestamp < pin.timestamp) {
        acc[key] = pin;
      }
      return acc;
    }, {} as Record<string, (typeof props.pins)[0]>)
  );

  const lastEventPin =
    props.pins.length > 0
      ? props.pins.reduce((latest, pin) =>
          pin.timestamp > latest.timestamp ? pin : latest
        )
      : null;
  const mapCenter: [number, number] = lastEventPin
    ? [lastEventPin.latitude, lastEventPin.longitude]
    : [51.505, -0.09];

  if (!width || !height || width === 0 || height === 0)
    return null; // You can only render the map once, subsequent re-renders won't do anything - so we need to wait until we have the viewport size
  else
    return (
      <div style={{ display: "flex", height: height, width: width }}>
        <div style={{ flexGrow: 1 }}>
          <MapContainer
            zoom={13}
            center={mapCenter}
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
              devices={props.devices}
              disabled={shapeEditing !== null}
            />
            {shapeEditing && (
              <ShapeEditLayer
                selectionRef={selectionRef}
                revision={selectionRevision}
                paintMode={paintMode}
                brushRadius={Number(brushRadius) || 1}
                anchor={[shapeEditing.latitude, shapeEditing.longitude]}
                onSelectionChange={setSelectionSize}
                onGridAvailable={setGridAvailable}
              />
            )}
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
            {props.timingPoints.map((pin) => (
              <Fragment key={pin.id}>
                <Marker
                  position={[pin.latitude, pin.longitude]}
                  icon={tablerMapIcon(
                    <ThemeIcon radius="xl" size="sm" color="orange">
                      <IconPinned style={{ width: "70%", height: "70%" }} />
                    </ThemeIcon>
                  )}
                >
                  <Popup>
                    <Text>{pin.name}</Text>
                    <Text>Cells: {cellCount(pin)}</Text>
                    <Text>Device: {deviceNameById(pin.deviceId)}</Text>
                    <Text>Order: {pin.order}</Text>
                    <Group gap="xs" mt="xs">
                      <Button size="xs" onClick={() => setEditingPoint(pin)}>
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => startShapeEdit(pin)}
                      >
                        Edit shape
                      </Button>
                    </Group>
                  </Popup>
                </Marker>
                {shapeEditing?.id !== pin.id && (
                  <Polygon
                    positions={outlines.get(pin.id) ?? []}
                    pathOptions={{ color: "blue", weight: 2, fillOpacity: 0.15 }}
                    interactive={false}
                  />
                )}
              </Fragment>
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
          {shapeEditing && (
            <Paper withBorder p="sm" mb="md">
              <Stack gap="xs">
                <Text fw={600}>Shape: {shapeEditing.name}</Text>
                <Text size="sm">
                  {selectionSize} cell{selectionSize === 1 ? "" : "s"} selected
                  {!gridAvailable &&
                    " — zoom in on the map to pick cells (cells are about 10 m across)"}
                </Text>
                <Switch
                  label="Paint by dragging"
                  description="Drag across cells to add them, or to remove them if you start on a selected one"
                  checked={paintMode}
                  onChange={(event) => setPaintMode(event.currentTarget.checked)}
                />
                {paintMode && (
                  <NumberInput
                    label="Brush radius (m)"
                    description="Cells cover about 10 m, so 25 m paints a patch of around 20"
                    size="xs"
                    w={150}
                    min={1}
                    max={500}
                    value={brushRadius}
                    onChange={setBrushRadius}
                  />
                )}
                <Group gap="xs" align="flex-end">
                  <NumberInput
                    label="Circle radius (m)"
                    size="xs"
                    w={110}
                    min={1}
                    value={circleRadius}
                    onChange={setCircleRadius}
                  />
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() =>
                      replaceSelection(
                        cellsForCircle(
                          shapeEditing.latitude,
                          shapeEditing.longitude,
                          Number(circleRadius) || 1,
                        ),
                      )
                    }
                  >
                    Reset to circle
                  </Button>
                </Group>
                <Group gap="xs">
                  <Button
                    size="xs"
                    loading={shapeSaving}
                    disabled={selectionSize === 0}
                    onClick={() =>
                      shapeFetcher.submit(
                        {
                          intent: "shape",
                          id: String(shapeEditing.id),
                          cells: JSON.stringify([...selectionRef.current]),
                        },
                        { method: "put", action: props.editorPath },
                      )
                    }
                  >
                    Save shape
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() => replaceSelection([])}
                  >
                    Clear
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() => setShapeEditing(null)}
                  >
                    Cancel
                  </Button>
                </Group>
              </Stack>
            </Paper>
          )}
          <List>
            {props.timingPoints.map((point) => (
              <List.Item key={point.id}>
                <Group>
                  <Text>
                    {point.name}{" "}
                    <Text span c="dimmed" size="xs">
                      ({deviceNameById(point.deviceId)})
                    </Text>
                  </Text>
                  <Button onClick={() => setEditingPoint(point)}>Edit</Button>
                  <Button
                    variant="light"
                    disabled={shapeEditing !== null}
                    onClick={() => startShapeEdit(point)}
                  >
                    Shape
                  </Button>
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
                label="Order"
                name="order"
                defaultValue={editingPoint.order}
              />
              <TagsInput
                label="Badges"
                description="Press Enter after each badge, e.g. Blue route"
                name="badges"
                defaultValue={editingPoint.badges}
                data={badgesForDevice(editingPoint.deviceId)}
              />
              <Textarea
                label="Description"
                name="description"
                autosize
                minRows={2}
                defaultValue={editingPoint.description ?? ""}
              />
              <Select
                label="Device"
                name="deviceId"
                required
                defaultValue={String(editingPoint.deviceId)}
                data={props.devices.map((device) => ({
                  value: String(device.id),
                  label: device.name,
                }))}
              />
              <Button type="submit">Save</Button>
            </fetcher.Form>
          </Modal>
        )}
      </div>
    );
};
