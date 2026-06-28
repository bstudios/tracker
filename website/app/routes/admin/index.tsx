import { Button, Container, Stack, Text, Title } from "@mantine/core";
import { sql } from "drizzle-orm";
import { Link, type MetaFunction } from "react-router";
import * as Schema from "~/database/schema.d";
import type { Route } from "./+types/index";

export const meta: MetaFunction = () => {
  return [{ title: "Admin" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const availableDateRows = await context.db
    .select({
      date: sql<string>`strftime('%Y-%m-%d', ${Schema.Events.timestamp} / 1000, 'unixepoch')`.as(
        "date"
      ),
    })
    .from(Schema.Events)
    .groupBy(sql`strftime('%Y-%m-%d', ${Schema.Events.timestamp} / 1000, 'unixepoch')`)
    .orderBy(
      sql`strftime('%Y-%m-%d', ${Schema.Events.timestamp} / 1000, 'unixepoch') DESC`
    );

  return { availableDates: availableDateRows.map((row) => row.date) };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <Container fluid p="md">
      <Title order={1}>Admin</Title>
      <Stack mt="md">
        <Button component={Link} to="/admin/passwords">
          Password administration
        </Button>
      </Stack>

      <Title order={2} mt="xl" mb="sm">
        Timing point editor by date
      </Title>
      {loaderData.availableDates.length === 0 ? (
        <Text c="dimmed">No data available yet</Text>
      ) : (
        <Stack>
          {loaderData.availableDates.map((date) => (
            <Button
              key={date}
              component={Link}
              to={`/admin/${date}/timingPointEditor`}
              variant="light"
            >
              {date}
            </Button>
          ))}
        </Stack>
      )}
    </Container>
  );
}
