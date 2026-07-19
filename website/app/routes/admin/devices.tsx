import { getDb } from "~/routeContext";
import {
  Button,
  Container,
  Group,
  Select,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { eq, sql } from "drizzle-orm";
import { Form, type MetaFunction } from "react-router";
import {
  DEFAULT_DEVICE_ICON,
  DEVICE_ICON_OPTIONS,
  isDeviceIconName,
} from "~/constants/deviceIcons";
import { AccessPasswords } from "~/database/schema/AccessPasswords";
import { Events } from "~/database/schema/Events";
import { Devices } from "~/database/schema/Devices";
import type { Route } from "./+types/devices";

export const meta: MetaFunction = () => {
  return [{ title: "Device Admin" }];
};

const parseDeviceNameInput = (rawName: string) => {
  const name = rawName.trim();
  if (name.length === 0) {
    throw new Error("Device name is required");
  }
  return name;
};

const parseMatcherInput = (rawMatcher: string) => {
  const matcher = rawMatcher.trim();
  if (matcher.length === 0) {
    throw new Error("Matcher is required");
  }
  return matcher;
};

const parseDeviceIconInput = (rawIcon: FormDataEntryValue | null) => {
  const icon = typeof rawIcon === "string" ? rawIcon : "";
  if (!isDeviceIconName(icon)) {
    throw new Error("Invalid icon");
  }
  return icon;
};

const parseDeviceIdInput = (rawId: FormDataEntryValue | null) => {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid device entry");
  }
  return id;
};

const ensureNameIsUnique = async (
  db: ReturnType<typeof getDb>,
  name: string,
  excludeId?: number,
) => {
  const [existingDevice] = await db
    .select({ id: Devices.id })
    .from(Devices)
    .where(
      excludeId === undefined
        ? sql`lower(${Devices.name}) = ${name}`
        : sql`lower(${Devices.name}) = ${name} AND ${Devices.id} != ${excludeId}`,
    )
    .limit(1);

  if (existingDevice) {
    throw new Error("Device name already exists");
  }
};

const ensureMatcherIsUnique = async (
  db: ReturnType<typeof getDb>,
  matchId: string,
  excludeId?: number,
) => {
  const [existingDevice] = await db
    .select({ id: Devices.id })
    .from(Devices)
    .where(
      excludeId === undefined
        ? eq(Devices.matchId, matchId)
        : sql`${Devices.matchId} = ${matchId} AND ${Devices.id} != ${excludeId}`,
    )
    .limit(1);

  if (existingDevice) {
    throw new Error("Matcher already exists");
  }
};

export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(context);
  const passwordCounts = db
    .select({
      deviceId: AccessPasswords.deviceId,
      passwordCount: sql<number>`count(*)`.as("password_count"),
    })
    .from(AccessPasswords)
    .groupBy(AccessPasswords.deviceId)
    .as("password_counts");

  const eventCounts = db
    .select({
      deviceId: Events.deviceId,
      eventCount: sql<number>`count(*)`.as("event_count"),
    })
    .from(Events)
    .groupBy(Events.deviceId)
    .as("event_counts");

  const devices = await db
    .select({
      id: Devices.id,
      name: Devices.name,
      matchId: Devices.matchId,
      icon: Devices.icon,
      passwordCount: sql<number>`coalesce(${passwordCounts.passwordCount}, 0)`,
      eventCount: sql<number>`coalesce(${eventCounts.eventCount}, 0)`,
    })
    .from(Devices)
    .leftJoin(passwordCounts, eq(passwordCounts.deviceId, Devices.id))
    .leftJoin(eventCounts, eq(eventCounts.deviceId, Devices.id));

  return { devices };
}

export async function action({ context, request }: Route.ActionArgs) {
  const db = getDb(context);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const name = parseDeviceNameInput(
      (formData.get("name") as string | null) ?? "",
    );
    const matchId = parseMatcherInput(
      (formData.get("matchId") as string | null) ?? "",
    );
    const icon = parseDeviceIconInput(formData.get("icon"));
    await ensureNameIsUnique(db, name);
    await ensureMatcherIsUnique(db, matchId);

    await db.insert(Devices).values({ name, matchId, icon });
    return { success: true };
  }

  if (intent === "update") {
    const id = parseDeviceIdInput(formData.get("id"));
    const name = parseDeviceNameInput(
      (formData.get("name") as string | null) ?? "",
    );
    const matchId = parseMatcherInput(
      (formData.get("matchId") as string | null) ?? "",
    );
    const icon = parseDeviceIconInput(formData.get("icon"));
    await ensureNameIsUnique(db, name, id);
    await ensureMatcherIsUnique(db, matchId, id);

    await db
      .update(Devices)
      .set({ name, matchId, icon })
      .where(eq(Devices.id, id));
    return { success: true };
  }

  if (intent === "delete") {
    const id = parseDeviceIdInput(formData.get("id"));

    const [passwordAssociation] = await db
      .select({ id: AccessPasswords.id })
      .from(AccessPasswords)
      .where(eq(AccessPasswords.deviceId, id))
      .limit(1);

    if (passwordAssociation) {
      throw new Error(
        "Cannot delete a device that is connected to one or more passwords",
      );
    }

    const [eventAssociation] = await db
      .select({ id: Events.id })
      .from(Events)
      .where(eq(Events.deviceId, id))
      .limit(1);

    if (eventAssociation) {
      throw new Error(
        "Cannot delete a device that has one or more recorded events",
      );
    }

    await db.delete(Devices).where(eq(Devices.id, id));
    return { success: true };
  }

  throw new Error("Unsupported admin device action");
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <Container fluid p="md">
      <Title order={1}>Device Administration</Title>
      <Text c="dimmed" mb="md">
        Manage device names, matchers, and map icons used to connect and display
        incoming webhook data.
      </Text>

      <Form method="post">
        <input type="hidden" name="intent" value="create" />
        <Group align="end">
          <TextInput label="Device name" name="name" required />
          <TextInput label="Matcher" name="matchId" required />
          <Select
            label="Map icon"
            name="icon"
            data={DEVICE_ICON_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            defaultValue={DEFAULT_DEVICE_ICON}
            allowDeselect={false}
            required
          />
          <Button type="submit">Create</Button>
        </Group>
      </Form>

      <Table mt="lg" striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Icon</Table.Th>
            <Table.Th>Matcher</Table.Th>
            <Table.Th>Passwords</Table.Th>
            <Table.Th>Events</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {loaderData.devices.map((device) => {
            const hasAssociations =
              device.passwordCount > 0 || device.eventCount > 0;

            return (
              <Table.Tr key={device.id}>
                <Table.Td>
                  <Form id={`device-row-${device.id}`} method="post">
                    <input type="hidden" name="id" value={device.id} />
                    <TextInput
                      aria-label="Device name"
                      name="name"
                      defaultValue={device.name}
                      required
                    />
                  </Form>
                </Table.Td>
                <Table.Td>
                  <Select
                    aria-label="Map icon"
                    form={`device-row-${device.id}`}
                    name="icon"
                    data={DEVICE_ICON_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                    defaultValue={device.icon ?? DEFAULT_DEVICE_ICON}
                    allowDeselect={false}
                    required
                  />
                </Table.Td>
                <Table.Td>
                  <TextInput
                    aria-label="Matcher"
                    form={`device-row-${device.id}`}
                    name="matchId"
                    defaultValue={device.matchId}
                    required
                  />
                </Table.Td>
                <Table.Td>{device.passwordCount}</Table.Td>
                <Table.Td>{device.eventCount}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <Button
                      form={`device-row-${device.id}`}
                      name="intent"
                      value="update"
                      type="submit"
                    >
                      Save
                    </Button>
                    <Button
                      form={`device-row-${device.id}`}
                      name="intent"
                      value="delete"
                      type="submit"
                      color="red"
                      formNoValidate
                      disabled={hasAssociations}
                      title={
                        hasAssociations
                          ? "Cannot delete while passwords or events are associated"
                          : undefined
                      }
                    >
                      Delete
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Container>
  );
}
