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
  Progress,
} from "@mantine/core";
import { Link, type MetaFunction } from "react-router";
import * as Schema from "~/database/schema.d";
import { getDb, getPasswordRouteAccess } from "~/routeContext";
import { formatTime24, formatUtcDay, isTodayUtcDay } from "~/utils/dateTime";
import {
  loadBatteryStatus,
  type BatteryStatusReading,
} from "~/logbook/batteryStatus.server";
import type { Route } from "./+types/index";
import {
  IconAntennaBars5,
  IconBattery,
  IconBattery1,
  IconBattery2,
  IconBattery3,
  IconBattery4,
  IconBatteryCharging,
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
  const db = getDb(context);
  const events = await db
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
    batteryStatus:
      events.length > 0
        ? await loadBatteryStatus(db, { deviceId, dateString: urlDate })
        : [],
  };
}

const BatteryLevelIcon = ({
  reading,
  color,
}: {
  reading: BatteryStatusReading;
  color: string;
}) => {
  const props = { color, size: 32, stroke: 1.5 };
  if (reading.charging) return <IconBatteryCharging {...props} />;
  if (reading.level === null) return <IconBattery {...props} />;
  if (reading.level >= 87.5) return <IconBattery4 {...props} />;
  if (reading.level >= 62.5) return <IconBattery3 {...props} />;
  if (reading.level >= 37.5) return <IconBattery2 {...props} />;
  if (reading.level >= 12.5) return <IconBattery1 {...props} />;
  return <IconBattery {...props} />;
};

const formatReading = (reading: BatteryStatusReading) => {
  const value = Number.isInteger(reading.value)
    ? reading.value
    : reading.value.toFixed(reading.unit === "%" ? 0 : 2);
  if (!reading.unit) return `${value}`;
  return reading.unit === "%" ? `${value}%` : `${value} ${reading.unit}`;
};

export default function Page({ loaderData }: Route.ComponentProps) {
  const theme = useMantineTheme();
  const isToday = isTodayUtcDay(loaderData.urlDate);
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
              <Text fw={600}>{isToday ? "Live tracking map" : "Map"}</Text>
              <Text size="xs" c="dimmed">
                {isToday
                  ? "Follow along on the map"
                  : "See this day on the map"}
              </Text>
            </div>
          </UnstyledButton>
          <SimpleGrid cols={3} mt="md">
            <UnstyledButton
              className={classes.item}
              component={Link}
              to={`/${loaderData.password}/${loaderData.urlDate}/logbook`}
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
        {loaderData.batteryStatus.length > 0 ? (
          <Card withBorder radius="md" className={classes.card}>
            <Text className={classes.title}>Battery</Text>
            <SimpleGrid cols={{ base: 1, xs: 2 }} mt="md">
              {loaderData.batteryStatus.map((reading) => {
                const color = reading.isLow
                  ? theme.colors.red[6]
                  : reading.charging
                    ? theme.colors.green[6]
                    : theme.colors.pink[6];
                return (
                  <Group
                    key={reading.label}
                    className={classes.batteryItem}
                    wrap="nowrap"
                  >
                    <BatteryLevelIcon reading={reading} color={color} />
                    <Stack gap={4} style={{ flex: 1 }}>
                      <Group justify="space-between" wrap="nowrap">
                        <Text size="sm" fw={600}>
                          {reading.label}
                        </Text>
                        <Text
                          size="sm"
                          fw={600}
                          c={reading.isLow ? "red" : undefined}
                        >
                          {formatReading(reading)}
                        </Text>
                      </Group>
                      {reading.level !== null ? (
                        <Progress
                          value={reading.level}
                          color={
                            reading.isLow
                              ? "red"
                              : reading.charging
                                ? "green"
                                : "pink"
                          }
                          size="sm"
                          aria-label={`${reading.label} level`}
                        />
                      ) : null}
                      <Text size="xs" c="dimmed">
                        {reading.charging === true
                          ? "Charging · "
                          : reading.charging === false
                            ? "Not charging · "
                            : ""}
                        {isToday ? "Last reported" : "Last reading"}{" "}
                        {formatTime24(reading.timestamp)}
                      </Text>
                    </Stack>
                  </Group>
                );
              })}
            </SimpleGrid>
          </Card>
        ) : null}
      </Stack>
    </Container>
  );
}
