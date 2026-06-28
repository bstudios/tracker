import {
  Button,
  Container,
  Group,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { eq, sql } from "drizzle-orm";
import { Form, type MetaFunction } from "react-router";
import { parseAllowedDatesInput, parsePasswordInput } from "~/passwordAccess.server";
import { AccessPasswords } from "~/database/schema/AccessPasswords";
import type { Route } from "./+types/passwords";

export const meta: MetaFunction = () => {
  return [{ title: "Password Admin" }];
};

const ensurePasswordIsUnique = async (
  db: Route.ActionArgs["context"]["db"],
  password: string,
  excludeId?: number
) => {
  const [existingPassword] = await db
    .select({ id: AccessPasswords.id })
    .from(AccessPasswords)
    .where(
      excludeId === undefined
        ? sql`lower(${AccessPasswords.password}) = ${password}`
        : sql`lower(${AccessPasswords.password}) = ${password} AND ${AccessPasswords.id} != ${excludeId}`
    )
    .limit(1);

  if (existingPassword) {
    throw new Error("Password already exists");
  }
};

export async function loader({ context }: Route.LoaderArgs) {
  const passwords = await context.db
    .select({
      id: AccessPasswords.id,
      password: AccessPasswords.password,
      allowedDates: AccessPasswords.allowedDates,
    })
    .from(AccessPasswords);

  return { passwords };
}

export async function action({ context, request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const password = parsePasswordInput(
      (formData.get("password") as string | null) ?? ""
    );
    await ensurePasswordIsUnique(context.db, password);
    const allowedDates = parseAllowedDatesInput(
      (formData.get("allowedDates") as string | null) ?? ""
    );
    await context.db.insert(AccessPasswords).values({ password, allowedDates });
    return { success: true };
  }

  if (intent === "update") {
    const id = Number(formData.get("id"));
    const password = parsePasswordInput(
      (formData.get("password") as string | null) ?? ""
    );
    await ensurePasswordIsUnique(context.db, password, id);
    const allowedDates = parseAllowedDatesInput(
      (formData.get("allowedDates") as string | null) ?? ""
    );
    await context.db
      .update(AccessPasswords)
      .set({ password, allowedDates })
      .where(eq(AccessPasswords.id, id));
    return { success: true };
  }

  if (intent === "delete") {
    const id = Number(formData.get("id"));
    await context.db.delete(AccessPasswords).where(eq(AccessPasswords.id, id));
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
        Passwords use only letters, numbers, and hyphens, and are case-insensitive.
      </Text>

      <Form method="post">
        <input type="hidden" name="intent" value="create" />
        <Group align="end">
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
          <Button type="submit">Create</Button>
        </Group>
      </Form>

      <Table mt="lg" striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Password</Table.Th>
            <Table.Th>Allowed date</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {loaderData.passwords.map((entry) => (
            <Table.Tr key={entry.id}>
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
                    entry.allowedDates === null ? "" : entry.allowedDates[0] ?? ""
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
