import { getDb } from "~/routeContext";
import { Button, Container, Stack, Text, Title } from "@mantine/core";
import { desc } from "drizzle-orm";
import { Link, type MetaFunction } from "react-router";
import * as Schema from "~/database/schema.d";
import type { Route } from "./+types/index";

export const meta: MetaFunction = () => {
  return [{ title: "Admin" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const availableDateRows = await getDb(context)
    .select({
      date: Schema.Events.dateString,
    })
    .from(Schema.Events)
    .groupBy(Schema.Events.dateString)
    .orderBy(desc(Schema.Events.dateString));

  return { availableDateRows };
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
        Timing point editor by date
      </Title>
      {loaderData.availableDateRows.length === 0 ? (
        <Text c="dimmed">No data available yet</Text>
      ) : (
        <Stack>
          {loaderData.availableDateRows.map((row) => (
            <Button
              key={row.date}
              component={Link}
              to={`/admin/${row.date}/timingPointEditor`}
              variant="light"
            >
              {row.date}
            </Button>
          ))}
        </Stack>
      )}
    </Container>
  );
}
