import { and, eq, gte, lte } from "drizzle-orm";
import {
  Button,
  Card,
  Container,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { DateTime } from "luxon";
import { Link, type MetaFunction } from "react-router";
import * as Schema from "~/database/schema.d";
import { getDb, getPasswordRouteAccess } from "~/routeContext";
import type { Route } from "./+types/index";

export const meta: MetaFunction = () => {
  return [{ title: "Tracking Menu" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const { refDate, urlDate, password, deviceId } =
    getPasswordRouteAccess(context);
  const events = await getDb(context)
    .select({ id: Schema.Events.id })
    .from(Schema.Events)
    .where(
      and(
        eq(Schema.Events.deviceId, deviceId),
        gte(Schema.Events.timestamp, refDate.toMillis()),
        lte(Schema.Events.timestamp, refDate.toMillis() + 86400000),
      ),
    )
    .limit(1);

  return {
    date: refDate.toISO(),
    urlDate,
    password,
    hasData: events.length > 0,
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  if (!loaderData.hasData) {
    return (
      <Container fluid p="md">
        <Stack gap="md" align="center" py="xl">
          <Title order={2} ta="center">
            No data received for{" "}
            {loaderData.date
              ? DateTime.fromISO(loaderData.date).toFormat("yyyy-MM-dd")
              : loaderData.urlDate}{" "}
            yet
          </Title>
        </Stack>
      </Container>
    );
  }

  return (
    <Container fluid p="md">
      <Stack gap="md">
        <Title order={2}>
          Tracking menu for{" "}
          {loaderData.date
            ? DateTime.fromISO(loaderData.date).toFormat("yyyy-MM-dd")
            : loaderData.urlDate}
        </Title>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Card withBorder>
            <Stack gap="xs">
              <Title order={3}>Main pages</Title>
              <Text c="dimmed" size="sm">
                Start with the live map, then explore timing points and
                analysis.
              </Text>
              <Button
                component={Link}
                to={`/${loaderData.password}/${loaderData.urlDate}/live`}
                variant="light"
                justify="flex-start"
                fullWidth
              >
                Live tracking map
              </Button>
              <Button
                component={Link}
                to={`/${loaderData.password}/${loaderData.urlDate}/timings`}
                variant="light"
                justify="flex-start"
                fullWidth
              >
                Timing points
              </Button>
              <Button
                component={Link}
                to={`/${loaderData.password}/${loaderData.urlDate}/analysis`}
                variant="light"
                justify="flex-start"
                fullWidth
              >
                Analysis
              </Button>
            </Stack>
          </Card>

          <Card withBorder>
            <Stack gap="xs">
              <Title order={3}>Advanced</Title>
              <Text c="dimmed" size="sm">
                Deeper comparison and export options.
              </Text>
              <Button
                component={Link}
                to={`/${loaderData.password}/${loaderData.urlDate}/timingsHistoric`}
                variant="subtle"
                justify="flex-start"
                fullWidth
              >
                Historic comparison
              </Button>
              <Button
                component="a"
                href={`/${loaderData.password}/${loaderData.urlDate}/export.gpx`}
                variant="subtle"
                justify="flex-start"
                fullWidth
              >
                GPX download
              </Button>
            </Stack>
          </Card>
        </SimpleGrid>
      </Stack>
    </Container>
  );
}
