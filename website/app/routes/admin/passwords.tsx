import { getDb } from "~/routeContext";
import {
  Button,
  Container,
  Group,
  NativeSelect,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { eq, sql } from "drizzle-orm";
import { Form, Link, type MetaFunction } from "react-router";
import {
  parseAllowedDatesInput,
  parsePasswordInput,
} from "~/passwordAccess.server";
import { AccessPasswords } from "~/database/schema/AccessPasswords";
import { Devices } from "~/database/schema/Devices";
import type { Route } from "./+types/passwords";

export const meta: MetaFunction = () => {
  return [{ title: "Password Admin" }];
};

const ensurePasswordIsUnique = async (
  db: ReturnType<typeof getDb>,
  password: string,
  excludeId?: number,
) => {
  const [existingPassword] = await db
    .select({ id: AccessPasswords.id })
    .from(AccessPasswords)
    .where(
      excludeId === undefined
        ? sql`lower(${AccessPasswords.password}) = ${password}`
        : sql`lower(${AccessPasswords.password}) = ${password} AND ${AccessPasswords.id} != ${excludeId}`,
    )
    .limit(1);

  if (existingPassword) {
    throw new Error("Password already exists");
  }
};

const parseDeviceIdInput = (rawDeviceId: FormDataEntryValue | null) => {
  const deviceId = Number(rawDeviceId);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    throw new Error("Connected device is required");
  }
  return deviceId;
};

const parsePasswordIdInput = (rawId: FormDataEntryValue | null) => {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid password entry");
  }
  return id;
};

const ensureDeviceExists = async (
  db: ReturnType<typeof getDb>,
  deviceId: number,
) => {
  const [device] = await db
    .select({ id: Devices.id })
    .from(Devices)
    .where(eq(Devices.id, deviceId))
    .limit(1);

  if (!device) {
    throw new Error("Selected device does not exist");
  }
};

export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(context);
  const [passwords, devices] = await Promise.all([
    db
      .select({
        id: AccessPasswords.id,
        password: AccessPasswords.password,
        allowedDates: AccessPasswords.allowedDates,
        deviceId: AccessPasswords.deviceId,
      })
      .from(AccessPasswords),
    db
      .select({ id: Devices.id, name: Devices.name, matchId: Devices.matchId })
      .from(Devices),
  ]);

  return { passwords, devices };
}

export async function action({ context, request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const deviceId = parseDeviceIdInput(formData.get("deviceId"));
    await ensureDeviceExists(getDb(context), deviceId);
    const password = parsePasswordInput(
      (formData.get("password") as string | null) ?? "",
    );
    await ensurePasswordIsUnique(getDb(context), password);
    const allowedDates = parseAllowedDatesInput(
      (formData.get("allowedDates") as string | null) ?? "",
    );
    await getDb(context)
      .insert(AccessPasswords)
      .values({ password, allowedDates, deviceId });
    return { success: true };
  }

  if (intent === "update") {
    const id = parsePasswordIdInput(formData.get("id"));
    const deviceId = parseDeviceIdInput(formData.get("deviceId"));
    await ensureDeviceExists(getDb(context), deviceId);
    const password = parsePasswordInput(
      (formData.get("password") as string | null) ?? "",
    );
    await ensurePasswordIsUnique(getDb(context), password, id);
    const allowedDates = parseAllowedDatesInput(
      (formData.get("allowedDates") as string | null) ?? "",
    );
    await getDb(context)
      .update(AccessPasswords)
      .set({ password, allowedDates, deviceId })
      .where(eq(AccessPasswords.id, id));
    return { success: true };
  }

  if (intent === "delete") {
    const id = parsePasswordIdInput(formData.get("id"));
    await getDb(context)
      .delete(AccessPasswords)
      .where(eq(AccessPasswords.id, id));
    return { success: true };
  }

  throw new Error("Unsupported admin password action");
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <Container fluid p="md">
      <Title order={1}>Password Administration</Title>
      <Text c="dimmed" mb="md">
        Use one date (yyyy-MM-dd) or leave blank for unrestricted access.
      </Text>
      <Text c="dimmed" mb="md">
        Passwords use only letters, numbers, and hyphens, and are
        case-insensitive.
      </Text>

      {loaderData.devices.length === 0 && (
        <Text c="red" mb="md">
          No devices found. Create one in <Link to="/admin/devices">Device administration</Link> before managing passwords.
        </Text>
      )}

      <Form method="post">
        <input type="hidden" name="intent" value="create" />
        <Group align="end">
          <NativeSelect
            label="Connected device"
            name="deviceId"
            data={loaderData.devices.map((device) => ({
              value: String(device.id),
              label: `${device.name} (${device.matchId})`,
            }))}
            required
            disabled={loaderData.devices.length === 0}
          />
          <TextInput
            label="Password"
            name="password"
            pattern="[A-Za-z0-9-]+"
            required
            autoComplete="off"
          />
          <TextInput
            label="Allowed date"
            name="allowedDates"
            placeholder="2026-06-28 (leave blank for unrestricted)"
          />
          <Button type="submit" disabled={loaderData.devices.length === 0}>
            Create
          </Button>
        </Group>
      </Form>

      <Table mt="lg" striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Connected device</Table.Th>
            <Table.Th>Password</Table.Th>
            <Table.Th>Allowed date</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {loaderData.passwords.map((entry) => (
            <Table.Tr key={entry.id}>
              <Table.Td>
                <NativeSelect
                  aria-label="Connected device"
                  form={`password-row-${entry.id}`}
                  name="deviceId"
                  data={loaderData.devices.map((device) => ({
                    value: String(device.id),
                    label: `${device.name} (${device.matchId})`,
                  }))}
                  defaultValue={String(entry.deviceId)}
                  required
                  disabled={loaderData.devices.length === 0}
                />
              </Table.Td>
              <Table.Td>
                <Form id={`password-row-${entry.id}`} method="post">
                  <input type="hidden" name="id" value={entry.id} />
                  <TextInput
                    aria-label="Password"
                    name="password"
                    defaultValue={entry.password}
                    pattern="[A-Za-z0-9-]+"
                    required
                    autoComplete="off"
                  />
                </Form>
              </Table.Td>
              <Table.Td>
                <TextInput
                  aria-label="Allowed date"
                  form={`password-row-${entry.id}`}
                  name="allowedDates"
                  defaultValue={
                    entry.allowedDates === null
                      ? ""
                      : (entry.allowedDates[0] ?? "")
                  }
                />
              </Table.Td>
              <Table.Td>
                <Group gap="xs">
                  <Button
                    form={`password-row-${entry.id}`}
                    name="intent"
                    value="update"
                    type="submit"
                  >
                    Save
                  </Button>
                  <Button
                    form={`password-row-${entry.id}`}
                    name="intent"
                    value="delete"
                    type="submit"
                    color="red"
                    formNoValidate
                  >
                    Delete
                  </Button>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Container>
  );
}
