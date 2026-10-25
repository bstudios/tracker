import { getDb } from "~/routeContext";
import { Button, Container, Stack, Text, Title } from "@mantine/core";
import { asc } from "drizzle-orm";
import { Link, type MetaFunction } from "react-router";
import * as Schema from "~/database/schema.d";
import type { Route } from "./+types/index";

export const meta: MetaFunction = () => {
  return [{ title: "Admin" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const devices = await getDb(context)
    .select({ id: Schema.Devices.id, name: Schema.Devices.name })
    .from(Schema.Devices)
    .orderBy(asc(Schema.Devices.name));

  return { devices };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <Container fluid p="md">
      <Title order={1}>Admin</Title>
      <Stack mt="md">
        <Button component={Link} to="/admin/devices">
          Device administration
        </Button>
        <Button component={Link} to="/admin/passwords">
          Password administration
        </Button>
        <Button component={Link} to="/admin/data">
          Data administration
        </Button>
      </Stack>

      <Title order={2} mt="xl" mb="sm">
        Timing point editor by device
      </Title>
      {loaderData.devices.length === 0 ? (
        <Text c="dimmed">No devices set up yet</Text>
      ) : (
        <Stack>
          {loaderData.devices.map((device) => (
            <Button
              key={device.id}
              component={Link}
              to={`/admin/devices/${device.id}/timingPoints`}
              variant="light"
            >
              {device.name}
            </Button>
          ))}
        </Stack>
      )}
    </Container>
  );
}
