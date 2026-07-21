import { getDb } from "~/routeContext";
import { Button, Container, Table, Text, Title } from "@mantine/core";
import { desc, eq, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { Form, type MetaFunction } from "react-router";
import * as Schema from "~/database/schema.d";
import type { Route } from "./+types/data";

export const meta: MetaFunction = () => {
  return [{ title: "Data Administration" }];
};

const parseDateInput = (rawDate: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    throw new Error("Date must use yyyy-MM-dd format.");
  }

  const parsedDate = DateTime.fromFormat(rawDate, "yyyy-MM-dd", {
    zone: "utc",
  });
  if (!parsedDate.isValid) {
    throw new Error("Date must be a valid calendar date.");
  }

  return rawDate;
};

export async function loader({ context }: Route.LoaderArgs) {
  const availableDateRows = await getDb(context)
    .select({
      date: Schema.Events.dateString,
      dataPointCount: sql<number>`count(*)`.as("data_point_count"),
    })
    .from(Schema.Events)
    .groupBy(Schema.Events.dateString)
    .orderBy(desc(Schema.Events.dateString));

  return { availableDateRows };
}

export async function action({ context, request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "deleteDateData") {
    const date = parseDateInput((formData.get("date") as string | null) ?? "");
    await getDb(context)
      .delete(Schema.Events)
      .where(eq(Schema.Events.dateString, date));

    return { success: true };
  }

  throw new Error("Unsupported data admin action");
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <Container fluid p="md">
      <Title order={1}>Data Administration</Title>

      <Title order={2} mt="xl" mb="sm">
        Data by date
      </Title>
      {loaderData.availableDateRows.length === 0 ? (
        <Text c="dimmed">No data available yet</Text>
      ) : (
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th>Data points</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loaderData.availableDateRows.map((row) => (
              <Table.Tr key={row.date}>
                <Table.Td>{row.date}</Table.Td>
                <Table.Td>{row.dataPointCount}</Table.Td>
                <Table.Td>
                  <Form method="post">
                    <input type="hidden" name="intent" value="deleteDateData" />
                    <input type="hidden" name="date" value={row.date} />
                    <Button
                      type="submit"
                      color="red"
                      variant="light"
                      onClick={(event) => {
                        if (
                          !window.confirm(
                            `Are you sure you want to delete all ${row.dataPointCount} data points for ${row.date}? This action cannot be undone.`,
                          )
                        ) {
                          event.preventDefault();
                        }
                      }}
                    >
                      Delete all data for date
                    </Button>
                  </Form>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
}
