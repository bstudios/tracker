import {
  getCloudflareContext,
  getDb,
  getPasswordRouteAccess,
} from "~/routeContext";
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
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconChevronLeft,
  IconChevronRight,
  IconFileTypePdf,
  IconMessagePlus,
  IconRefresh,
} from "@tabler/icons-react";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { useState, type ReactNode } from "react";
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
import {
  invalidateLogbookArchive,
  isDayComplete,
} from "~/logbook/pdfArchive.server";
import { DISPLAY_TIME_ZONE, formatTime24, formatUtcDay } from "~/utils/dateTime";
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
    truncated: logbook?.truncated ?? false,
    // Today's log is still growing, so there is nothing settled to download yet.
    canDownloadPdf: isDayComplete(urlDate) && (logbook?.eventCount ?? 0) > 0,
    ...adjacent,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const db = getDb(context);
  // The device comes from the password, never from the submitted form, so a password
  // cannot be used to add a timing point — or a remark — to somebody else's device.
  const { deviceId, urlDate } = getPasswordRouteAccess(context);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "add-remark") {
    const text = ((formData.get("text") as string | null) ?? "").trim();
    const time = ((formData.get("time") as string | null) ?? "").trim();

    if (text.length === 0) {
      return data({ error: "Write something to remark on" }, { status: 400 });
    }

    const parsedTime = DateTime.fromFormat(
      `${urlDate} ${time}`,
      "yyyy-MM-dd HH:mm",
      { zone: DISPLAY_TIME_ZONE },
    );
    if (!parsedTime.isValid) {
      return data({ error: "That time is not valid" }, { status: 400 });
    }

    await db.insert(Schema.LogbookRemarks).values({
      deviceId,
      dateString: urlDate,
      timestamp: parsedTime.toMillis(),
      text,
      createdAt: Date.now(),
    });

    return { error: null };
  }

  if (intent !== "create-timing-point") {
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

  // Every past day the boat stopped here now reads with the name instead of coordinates,
  // so the archived PDFs for those days no longer match the page.
  await invalidateLogbookArchive(getCloudflareContext(context).env, deviceId);

  return { error: null };
}

const KIND_STYLES: Record<LogbookEntryKind, { label: string; color: string }> =
  {
    first: { label: "Start", color: "gray" },
    last: { label: "End", color: "gray" },
    arrived: { label: "Arrived", color: "teal" },
    departed: { label: "Departed", color: "blue" },
    "signal-lost": { label: "Signal lost", color: "red" },
    "signal-restored": { label: "Signal restored", color: "green" },
    "timing-point-arrived": { label: "Arrived", color: "teal" },
    "timing-point-departed": { label: "Departed", color: "blue" },
    "timing-point-passed": { label: "Passed", color: "grape" },
    voltage: { label: "Power", color: "orange" },
    remark: { label: "Remark", color: "yellow" },
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
    canDownloadPdf,
    truncated,
  } = loaderData;

  const [namingEntry, setNamingEntry] = useState<LogbookEntry | null>(null);
  const [modalOpened, modal] = useDisclosure(false);
  const [remarkModalOpened, remarkModal] = useDisclosure(false);
  const navigation = useNavigation();

  const openNamingModal = (entry: LogbookEntry) => {
    setNamingEntry(entry);
    modal.open();
  };

  /**
   * Nothing is rendered when there is no adjacent day.
   *
   * A *disabled* Mantine Button would not do: `disabled` on one rendered with
   * `component={Link}` is styling only, so it still emits an href — on the earliest day
   * that meant a link to `/{password}/null/logbook`, which the date parser silently
   * resolves to today.
   */
  const dayLink = (
    date: string | null,
    sections: { leftSection?: ReactNode; rightSection?: ReactNode },
  ) =>
    date ? (
      <Button
        component={Link}
        to={`/${password}/${date}/logbook`}
        variant="light"
        size="compact-md"
        {...sections}
      >
        {date}
      </Button>
    ) : null;

  // Kept adjacent rather than pushed to opposite edges of a fluid container — the pair
  // reads as one control, and the dates label the buttons so nothing has to be inferred
  // from which side an arrow is on. The row is dropped entirely when it would be empty,
  // rather than leaving a gap above and below the table.
  const hasDayNav = Boolean(previousDate || nextDate || canDownloadPdf);
  const dayNav = hasDayNav ? (
    <Group gap="xs">
      {dayLink(previousDate, {
        leftSection: <IconChevronLeft size={16} />,
      })}
      {dayLink(nextDate, {
        rightSection: <IconChevronRight size={16} />,
      })}
      {canDownloadPdf ? (
        <Button
          component="a"
          href={`/${password}/${urlDate}/logbook.pdf`}
          variant="subtle"
          size="compact-md"
          leftSection={<IconFileTypePdf size={16} />}
        >
          Download PDF
        </Button>
      ) : null}
      {canDownloadPdf ? (
        <Button
          component="a"
          href={`/${password}/${urlDate}/logbook.pdf?regenerate`}
          variant="subtle"
          size="compact-md"
          color="gray"
          leftSection={<IconRefresh size={16} />}
          title="Rebuild the PDF, e.g. after renaming a timing point"
        >
          Regenerate PDF
        </Button>
      ) : null}
    </Group>
  ) : null;

  return (
    <Container fluid p="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div>
            <Title order={1}>Logbook — {formatUtcDay(urlDate)}</Title>
            <Text c="dimmed">
              {deviceName ? `${deviceName} · ` : ""}
              {eventCount} position report{eventCount === 1 ? "" : "s"},
              condensed to {entries.length} entr
              {entries.length === 1 ? "y" : "ies"}. Times are local.
            </Text>
          </div>
          <Button
            variant="light"
            size="compact-md"
            leftSection={<IconMessagePlus size={16} />}
            onClick={remarkModal.open}
          >
            Add remark
          </Button>
        </Group>

        {dayNav}

        {actionData?.error ? (
          <Alert color="red">{actionData.error}</Alert>
        ) : null}

        {truncated ? (
          <Alert color="yellow" title="Partial day">
            This device reported more positions than one log can be built from,
            so only the earliest {eventCount.toLocaleString()} are included.
            Later entries for this day are missing.
          </Alert>
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

      <Modal
        opened={remarkModalOpened}
        onClose={remarkModal.close}
        title="Add a remark"
        centered
      >
        <Form method="post" onSubmit={remarkModal.close}>
          <input type="hidden" name="intent" value="add-remark" />
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Adds a note to this day&apos;s logbook at the time given, e.g. a
              sail change or something worth remembering that the tracker
              wouldn&apos;t otherwise show.
            </Text>
            <TextInput
              type="time"
              label="Time"
              name="time"
              defaultValue={DateTime.now()
                .setZone(DISPLAY_TIME_ZONE)
                .toFormat("HH:mm")}
              data-autofocus
              required
            />
            <Textarea
              label="Remark"
              name="text"
              placeholder="Reefed the main, wind picking up"
              autosize
              minRows={2}
              required
            />
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={remarkModal.close}
                type="button"
              >
                Cancel
              </Button>
              <Button type="submit" loading={navigation.state === "submitting"}>
                Add
              </Button>
            </Group>
          </Stack>
        </Form>
      </Modal>
    </Container>
  );
}
