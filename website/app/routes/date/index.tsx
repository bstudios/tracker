import { and, eq } from "drizzle-orm";
import {
  Button,
  Card,
  Container,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
  useMantineTheme,
  Anchor,
  Group,
} from "@mantine/core";
import { Link, type MetaFunction } from "react-router";
import * as Schema from "~/database/schema.d";
import { getDb, getPasswordRouteAccess } from "~/routeContext";
import { formatUtcDay } from "~/utils/dateTime";
import type { Route } from "./+types/index";
import {
  IconAntennaBars5,
  IconDeviceAnalytics,
  IconDownload,
  IconGitCompare,
  IconMap,
  IconNotebook,
  IconStopwatch,
} from "@tabler/icons-react";
import classes from "~/components/DateIndexTable.module.css";
import { DateTime } from "luxon";

export function ActionsGrid() {}
export const meta: MetaFunction = () => {
  return [{ title: "Tracking Menu" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const { urlDate, password, deviceId } = getPasswordRouteAccess(context);
  const events = await getDb(context)
    .select({ id: Schema.Events.id })
    .from(Schema.Events)
    .where(
      and(
        eq(Schema.Events.deviceId, deviceId),
        eq(Schema.Events.dateString, urlDate),
      ),
    )
    .limit(1);

  return {
    urlDate,
    password,
    hasData: events.length > 0,
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const theme = useMantineTheme();
  if (!loaderData.hasData) {
    return (
      <Container fluid p="md">
        <Stack gap="md" align="center" py="xl">
          <Title order={2} ta="center">
            No data received for {formatUtcDay(loaderData.urlDate)} yet
          </Title>
        </Stack>
      </Container>
    );
  }

  return (
    <Container p="md">
      <Stack gap="md">
        <Card withBorder radius="md" className={classes.card}>
          <Group justify="space-between">
            <Text className={classes.title}>
              Tracking menu for{" "}
              {DateTime.fromFormat(loaderData.urlDate, "yyyy-MM-dd", {
                zone: "utc",
              }).toFormat("cccc d LLL")}
            </Text>
            <Anchor
              c="inherit"
              size="xs"
              to={`/${loaderData.password}`}
              component={Link}
            >
              Change date
            </Anchor>
          </Group>
          <UnstyledButton
            className={classes.primaryItem}
            component={Link}
            to={`/${loaderData.password}/${loaderData.urlDate}/live`}
            prefetch="render"
            mt="md"
          >
            <IconMap color={theme.colors.pink[6]} size={40} stroke={1.5} />
            <div>
              <Text fw={600}>Live tracking map</Text>
              <Text size="xs" c="dimmed">
                Follow along on the map
              </Text>
            </div>
          </UnstyledButton>
          <SimpleGrid cols={3} mt="md">
            <UnstyledButton
              className={classes.item}
              component={Link}
              to={`/${loaderData.password}/${loaderData.urlDate}/logbook`}
              prefetch="intent"
            >
              <IconNotebook
                color={theme.colors.pink[6]}
                size={32}
                stroke={1.5}
              />
              <Text size="xs" mt={7}>
                Logbook
              </Text>
            </UnstyledButton>
            <UnstyledButton
              className={classes.item}
              component={Link}
              to={`/${loaderData.password}/${loaderData.urlDate}/timings`}
              prefetch="intent"
            >
              <IconStopwatch
                color={theme.colors.pink[6]}
                size={32}
                stroke={1.5}
              />
              <Text size="xs" mt={7}>
                Timing Points
              </Text>
            </UnstyledButton>
            <UnstyledButton
              className={classes.item}
              component={Link}
              to={`/${loaderData.password}/${loaderData.urlDate}/analysis`}
              prefetch="intent"
            >
              <IconDeviceAnalytics
                color={theme.colors.pink[6]}
                size={32}
                stroke={1.5}
              />
              <Text size="xs" mt={7}>
                Analysis
              </Text>
            </UnstyledButton>
            <UnstyledButton
              className={classes.item}
              component={Link}
              to={`/${loaderData.password}/${loaderData.urlDate}/timingsHistoric`}
              prefetch="intent"
            >
              <IconGitCompare
                color={theme.colors.pink[6]}
                size={32}
                stroke={1.5}
              />
              <Text size="xs" mt={7}>
                Historic comparison
              </Text>
            </UnstyledButton>
            <UnstyledButton
              className={classes.item}
              component={Link}
              to={`/${loaderData.password}/${loaderData.urlDate}/signal`}
              prefetch="intent"
            >
              <IconAntennaBars5
                color={theme.colors.pink[6]}
                size={32}
                stroke={1.5}
              />
              <Text size="xs" mt={7}>
                Signal map
              </Text>
            </UnstyledButton>
            <UnstyledButton
              className={classes.item}
              component={"a"}
              href={`/${loaderData.password}/${loaderData.urlDate}/export.gpx`}
            >
              <IconDownload
                color={theme.colors.pink[6]}
                size={32}
                stroke={1.5}
              />
              <Text size="xs" mt={7}>
                GPX download
              </Text>
            </UnstyledButton>
          </SimpleGrid>
        </Card>
      </Stack>
    </Container>
  );
}
