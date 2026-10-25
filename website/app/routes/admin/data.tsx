import { getCloudflareContext, getDb } from "~/routeContext";
import { Button, Container, Table, Text, Title } from "@mantine/core";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { Form, type MetaFunction } from "react-router";
import * as Schema from "~/database/schema.d";
import { invalidateLogbookArchiveDay } from "~/logbook/pdfArchive.server";
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

const parseDeviceIdInput = (rawDeviceId: string) => {
  const deviceId = Number(rawDeviceId);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    throw new Error("Invalid device ID");
  }
  return deviceId;
};

export async function loader({ context }: Route.LoaderArgs) {
  const availableDateRows = await getDb(context)
    .select({
      date: Schema.Events.dateString,
      deviceId: Schema.Events.deviceId,
      deviceName: Schema.Devices.name,
      dataPointCount: sql<number>`count(*)`.as("data_point_count"),
    })
    .from(Schema.Events)
    .innerJoin(Schema.Devices, eq(Schema.Events.deviceId, Schema.Devices.id))
    .groupBy(Schema.Events.dateString, Schema.Events.deviceId)
    .orderBy(desc(Schema.Events.dateString), asc(Schema.Devices.name));

  return { availableDateRows };
}

export async function action({ context, request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "deleteDeviceDateData") {
    const date = parseDateInput((formData.get("date") as string | null) ?? "");
    const deviceId = parseDeviceIdInput(
      (formData.get("deviceId") as string | null) ?? "",
    );
    await getDb(context)
      .delete(Schema.Events)
      .where(
        and(
          eq(Schema.Events.deviceId, deviceId),
          eq(Schema.Events.dateString, date),
        ),
      );
    // The archived logbook PDF for this day was rendered from the events just deleted.
    await invalidateLogbookArchiveDay(
      getCloudflareContext(context).env,
      deviceId,
      date,
    );

    return { success: true };
  }

  throw new Error("Unsupported data admin action");
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <Container fluid p="md">
      <Title order={1}>Data Administration</Title>

      <Title order={2} mt="xl" mb="sm">
        Data by date and device
      </Title>
      {loaderData.availableDateRows.length === 0 ? (
        <Text c="dimmed">No data available yet</Text>
      ) : (
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th>Device</Table.Th>
              <Table.Th>Data points</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loaderData.availableDateRows.map((row) => (
              <Table.Tr key={`${row.date}-${row.deviceId}`}>
                <Table.Td>{row.date}</Table.Td>
                <Table.Td>{row.deviceName}</Table.Td>
                <Table.Td>{row.dataPointCount}</Table.Td>
                <Table.Td>
                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="deleteDeviceDateData"
                    />
                    <input type="hidden" name="date" value={row.date} />
                    <input type="hidden" name="deviceId" value={row.deviceId} />
                    <Button
                      type="submit"
                      color="red"
                      variant="light"
                      onClick={(event) => {
                        if (
                          !window.confirm(
                            `Are you sure you want to delete all ${row.dataPointCount} data points for ${row.deviceName} on ${row.date}? This action cannot be undone.`,
                          )
                        ) {
                          event.preventDefault();
                        }
                      }}
                    >
                      Delete data for device on date
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
