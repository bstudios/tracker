import { getDb, getPasswordRouteAccess } from "~/routeContext";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Container,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { eq } from "drizzle-orm";
import { useState } from "react";
import {
  Form,
  Link,
  useNavigation,
  data,
  type MetaFunction,
} from "react-router";
import * as Schema from "~/database/schema.d";
import type { LogbookEntry, LogbookEntryKind } from "~/logbook/buildLogbook";
import {
  findAdjacentDaysWithData,
  loadLogbook,
} from "~/logbook/loadLogbook.server";
import { parseLogbookConfig } from "~/logbook/config";
import { formatTime24, formatUtcDay } from "~/utils/dateTime";
import { rebuildTimingPointH3Coverage } from "~/utils/timingPointH3";
import type { Route } from "./+types/logbook";

export const meta: MetaFunction = () => {
  return [{ title: "Logbook" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(context);
  const { urlDate, password, deviceId, allowedDates } =
    getPasswordRouteAccess(context);

  const [logbook, adjacent] = await Promise.all([
    loadLogbook(db, { deviceId, dateString: urlDate }),
    findAdjacentDaysWithData(db, {
      deviceId,
      dateString: urlDate,
      allowedDates,
    }),
  ]);

  return {
    urlDate,
    password,
    deviceName: logbook?.deviceName ?? null,
    entries: logbook?.entries ?? [],
    eventCount: logbook?.eventCount ?? 0,
    ...adjacent,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const db = getDb(context);
  // The device comes from the password, never from the submitted form, so a password
  // cannot be used to add a timing point to somebody else's device.
  const { deviceId } = getPasswordRouteAccess(context);
  const formData = await request.formData();

  if (formData.get("intent") !== "create-timing-point") {
    throw new Error("Unsupported logbook action");
  }

  const name = ((formData.get("name") as string | null) ?? "").trim();
  const latitude = Number(formData.get("latitude"));
  const longitude = Number(formData.get("longitude"));

  if (name.length === 0) {
    return data({ error: "Give the place a name" }, { status: 400 });
  }
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return data({ error: "That position is not valid" }, { status: 400 });
  }

  const [device] = await db
    .select({ logbookConfig: Schema.Devices.logbookConfig })
    .from(Schema.Devices)
    .where(eq(Schema.Devices.id, deviceId))
    .limit(1);

  // Default the radius to whatever counts as "stopped here" for this device, so a place
  // named from a logbook line will match the same stop again tomorrow.
  let radius = 100;
  try {
    radius = parseLogbookConfig(device?.logbookConfig).stationary.radiusMeters;
  } catch {
    // Leave the default; a malformed config is the admin page's problem to report.
  }

  const [timingPoint] = await db
    .insert(Schema.TimingPoints)
    .values({ name, deviceId, latitude, longitude, radius, h3Index: "" })
    .returning({
      id: Schema.TimingPoints.id,
      latitude: Schema.TimingPoints.latitude,
      longitude: Schema.TimingPoints.longitude,
      radius: Schema.TimingPoints.radius,
    });

  // Without its H3 coverage rows a timing point matches nothing, so build them now rather
  // than leaving a point that silently never appears on the timings page.
  await rebuildTimingPointH3Coverage(db, timingPoint);

  return { error: null };
}

const KIND_STYLES: Record<LogbookEntryKind, { label: string; color: string }> =
  {
    first: { label: "Start", color: "gray" },
    last: { label: "End", color: "gray" },
    arrived: { label: "Arrived", color: "teal" },
    departed: { label: "Departed", color: "blue" },
    "timing-point-arrived": { label: "Arrived", color: "teal" },
    "timing-point-departed": { label: "Departed", color: "blue" },
    "timing-point-passed": { label: "Passed", color: "grape" },
    voltage: { label: "Power", color: "orange" },
  };

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const {
    urlDate,
    password,
    deviceName,
    entries,
    eventCount,
    previousDate,
    nextDate,
  } = loaderData;

  const [namingEntry, setNamingEntry] = useState<LogbookEntry | null>(null);
  const [modalOpened, modal] = useDisclosure(false);
  const navigation = useNavigation();

  const openNamingModal = (entry: LogbookEntry) => {
    setNamingEntry(entry);
    modal.open();
  };

  // Kept adjacent rather than pushed to opposite edges of a fluid container — the pair
  // reads as one control, and the dates label the buttons so nothing has to be inferred
  // from which side an arrow is on.
  const dayNav = (
    <Group gap="xs">
      <Button
        component={Link}
        to={`/${password}/${previousDate}/logbook`}
        variant="light"
        size="compact-md"
        leftSection={<IconChevronLeft size={16} />}
        disabled={!previousDate}
      >
        {previousDate ?? "No earlier data"}
      </Button>
      <Button
        component={Link}
        to={`/${password}/${nextDate}/logbook`}
        variant="light"
        size="compact-md"
        rightSection={<IconChevronRight size={16} />}
        disabled={!nextDate}
      >
        {nextDate ?? "No later data"}
      </Button>
    </Group>
  );

  return (
    <Container fluid p="md">
      <Stack gap="md">
        <div>
          <Title order={1}>Logbook — {formatUtcDay(urlDate)}</Title>
          <Text c="dimmed">
            {deviceName ? `${deviceName} · ` : ""}
            {eventCount} position report{eventCount === 1 ? "" : "s"}, condensed
            to {entries.length} entr{entries.length === 1 ? "y" : "ies"}. Times
            are local.
          </Text>
        </div>

        {dayNav}

        {actionData?.error ? (
          <Alert color="red">{actionData.error}</Alert>
        ) : null}

        {entries.length === 0 ? (
          <Alert color="gray">No data received for {urlDate} yet.</Alert>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={90}>Time</Table.Th>
                <Table.Th w={110}>Type</Table.Th>
                <Table.Th>Entry</Table.Th>
                <Table.Th>Detail</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((entry, index) => {
                const style = KIND_STYLES[entry.kind];
                return (
                  <Table.Tr key={`${entry.kind}-${entry.timestamp}-${index}`}>
                    <Table.Td>{formatTime24(entry.timestamp)}</Table.Td>
                    <Table.Td>
                      <Badge color={style.color} variant="light">
                        {style.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {entry.latitude !== undefined &&
                      entry.longitude !== undefined ? (
                        <Anchor
                          c="inherit"
                          href={`https://www.google.com/maps?q=${entry.latitude},${entry.longitude}`}
                          target="_blank"
                        >
                          {entry.title}
                        </Anchor>
                      ) : (
                        entry.title
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <Text size="sm" c="dimmed">
                          {entry.detail}
                        </Text>
                        {entry.nameable ? (
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            onClick={() => openNamingModal(entry)}
                          >
                            Name this place
                          </Button>
                        ) : null}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}

        {dayNav}
      </Stack>

      <Modal
        opened={modalOpened}
        onClose={modal.close}
        title="Name this place"
        centered
      >
        <Form method="post" onSubmit={modal.close}>
          <input type="hidden" name="intent" value="create-timing-point" />
          <input
            type="hidden"
            name="latitude"
            value={namingEntry?.nameable?.latitude ?? ""}
          />
          <input
            type="hidden"
            name="longitude"
            value={namingEntry?.nameable?.longitude ?? ""}
          />
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Creates a timing point here, so future visits are logged by name.
              Editing or removing it afterwards needs admin access.
            </Text>
            <TextInput
              label="Name"
              name="name"
              placeholder="Yarmouth Harbour"
              data-autofocus
              required
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={modal.close} type="button">
                Cancel
              </Button>
              <Button type="submit" loading={navigation.state === "submitting"}>
                Create
              </Button>
            </Group>
          </Stack>
        </Form>
      </Modal>
    </Container>
  );
}
