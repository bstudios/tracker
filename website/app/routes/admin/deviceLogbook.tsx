import { getCloudflareContext, getDb } from "~/routeContext";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Code,
  Container,
  Group,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { desc, eq } from "drizzle-orm";
import { Form, Link, data, type MetaFunction } from "react-router";
import { z } from "zod";
import { Devices } from "~/database/schema/Devices";
import { Events } from "~/database/schema/Events";
import { LOGBOOK_CONFIG_EXAMPLE, parseLogbookConfig } from "~/logbook/config";
import { findNumericJsonPaths } from "~/logbook/detectVoltageFields";
import { invalidateLogbookArchive } from "~/logbook/pdfArchive.server";
import type { Route } from "./+types/deviceLogbook";

export const meta: MetaFunction = () => {
  return [{ title: "Logbook Settings" }];
};

/** How many recent events to inspect when listing the numeric fields a device reports. */
const FIELD_SAMPLE_SIZE = 200;

const parseDeviceIdParam = (rawId: string | undefined) => {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Response("Not found", { status: 404 });
  }
  return id;
};

/**
 * Split the admin's CSV into addresses.
 *
 * The check is deliberately loose — enough to catch a missed comma or a stray word, but
 * not an attempt to decide what is deliverable. Delivery failures are reported per
 * recipient by the workflow instead.
 */
export const parseEmailRecipients = (raw: string): string[] => {
  const recipients = raw
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const invalid = recipients.filter(
    (entry) => !/^[^\s@]+@[^\s@.]+\.\S+$/.test(entry),
  );
  if (invalid.length > 0) {
    throw new Error(`Not a valid email address: ${invalid.join(", ")}`);
  }

  return Array.from(new Set(recipients));
};

export async function loader({ context, params }: Route.LoaderArgs) {
  const db = getDb(context);
  const deviceId = parseDeviceIdParam(params.deviceId);

  const [device] = await db
    .select({
      id: Devices.id,
      name: Devices.name,
      logbookConfig: Devices.logbookConfig,
      logbookEmailRecipients: Devices.logbookEmailRecipients,
    })
    .from(Devices)
    .where(eq(Devices.id, deviceId))
    .limit(1);

  if (!device) {
    throw new Response("Device not found", { status: 404 });
  }

  // Sample recent events so the admin can pick a voltage path from what this device
  // actually reports rather than guessing at flespi's field naming.
  const recentEvents = await db
    .select({ data: Events.data })
    .from(Events)
    .where(eq(Events.deviceId, deviceId))
    .orderBy(desc(Events.timestamp))
    .limit(FIELD_SAMPLE_SIZE);

  return {
    device: {
      id: device.id,
      name: device.name,
      // Round-trip through the stored value rather than the parsed one so the admin sees
      // exactly what is saved, including any fields defaults would have filled in.
      configJson: device.logbookConfig
        ? JSON.stringify(device.logbookConfig, null, 2)
        : "",
      recipients: device.logbookEmailRecipients ?? "",
    },
    detectedFields: findNumericJsonPaths(
      recentEvents.map((event) => event.data),
    ),
    sampleSize: recentEvents.length,
  };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const db = getDb(context);
  const deviceId = parseDeviceIdParam(params.deviceId);
  const formData = await request.formData();

  const rawConfig = (
    (formData.get("logbookConfig") as string | null) ?? ""
  ).trim();
  const rawRecipients = (
    (formData.get("logbookEmailRecipients") as string | null) ?? ""
  ).trim();

  // Re-render with the submitted text and an explanation rather than throwing to the error
  // boundary, so a typo does not cost the admin everything they just typed.
  let logbookConfig = null;
  try {
    if (rawConfig.length > 0) {
      logbookConfig = parseLogbookConfig(JSON.parse(rawConfig));
    }
  } catch (error) {
    return data(
      {
        error:
          error instanceof z.ZodError
            ? z.prettifyError(error)
            : `Config is not valid JSON: ${(error as Error).message}`,
        submittedConfig: rawConfig,
        submittedRecipients: rawRecipients,
      },
      { status: 400 },
    );
  }

  let recipients: string[];
  try {
    recipients = parseEmailRecipients(rawRecipients);
  } catch (error) {
    return data(
      {
        error: (error as Error).message,
        submittedConfig: rawConfig,
        submittedRecipients: rawRecipients,
      },
      { status: 400 },
    );
  }

  await db
    .update(Devices)
    .set({
      logbookConfig,
      logbookEmailRecipients:
        recipients.length > 0 ? recipients.join(", ") : null,
    })
    .where(eq(Devices.id, deviceId));

  // Changing the bands or the stop thresholds changes what every past day's log says, so
  // the PDFs archived against the old config are no longer what the page would render.
  await invalidateLogbookArchive(getCloudflareContext(context).env, deviceId);

  return { error: null, submittedConfig: null, submittedRecipients: null };
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const { device, detectedFields, sampleSize } = loaderData;
  const saved = actionData?.error === null;

  return (
    <Container fluid p="md">
      <Stack gap="md">
        <div>
          <Title order={1}>Logbook settings — {device.name}</Title>
          <Text c="dimmed">
            Controls how this device&apos;s day is condensed into logbook lines,
            and who receives the nightly PDF.{" "}
            <Anchor component={Link} to="/admin/devices">
              Back to devices
            </Anchor>
          </Text>
        </div>

        {actionData?.error ? (
          <Alert color="red" title="Not saved">
            <Code block>{actionData.error}</Code>
          </Alert>
        ) : null}
        {saved ? <Alert color="green">Logbook settings saved.</Alert> : null}

        <Form method="post">
          <Stack gap="md">
            <Textarea
              label="Daily email recipients"
              description="Comma separated. Leave blank to disable the nightly logbook email for this device."
              name="logbookEmailRecipients"
              placeholder="skipper@example.com, owner@example.com"
              autosize
              minRows={2}
              defaultValue={
                actionData?.submittedRecipients ?? device.recipients
              }
            />

            <Textarea
              label="Logbook configuration (JSON)"
              description="Leave blank to use the defaults: stop after 15 minutes within 100 m, and no voltage lines."
              name="logbookConfig"
              placeholder={LOGBOOK_CONFIG_EXAMPLE}
              autosize
              minRows={12}
              styles={{ input: { fontFamily: "monospace" } }}
              defaultValue={actionData?.submittedConfig ?? device.configJson}
            />

            <Group>
              <Button type="submit">Save</Button>
            </Group>
          </Stack>
        </Form>

        <Card withBorder>
          <Stack gap="xs">
            <Title order={3}>Numeric fields seen on this device</Title>
            <Text c="dimmed" size="sm">
              Taken from the {sampleSize} most recent event
              {sampleSize === 1 ? "" : "s"}. Copy a path into a voltage
              source&apos;s <Code>jsonPath</Code> to log its band changes.
            </Text>
            {detectedFields.length === 0 ? (
              <Text c="dimmed" size="sm">
                No numeric fields found — this device may not have reported yet.
              </Text>
            ) : (
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>JSON path</Table.Th>
                    <Table.Th>Most recent value</Table.Th>
                    <Table.Th>Range seen</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {detectedFields.map((field) => (
                    <Table.Tr key={field.jsonPath}>
                      <Table.Td>
                        <Code>{field.jsonPath}</Code>
                      </Table.Td>
                      <Table.Td>{field.latestValue}</Table.Td>
                      <Table.Td>
                        {field.minValue === field.maxValue
                          ? field.minValue
                          : `${field.minValue} – ${field.maxValue}`}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        </Card>
      </Stack>
    </Container>
  );
}
