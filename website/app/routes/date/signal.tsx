import { getDb, getPasswordRouteAccess } from "~/routeContext";
import {
  Card,
  Center,
  Container,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { and, eq, sql } from "drizzle-orm";
import type { MetaFunction } from "react-router";
import { SignalMap } from "~/components/SignalMap/SignalMap";
import type { HexCell } from "~/components/SignalMap/SignalMap.client";
import {
  buildSignalLegendTicks,
  getSignalRange,
  signalToColor,
} from "~/components/SignalMap/signalColor";
import { assignNetworkColors } from "~/components/SignalMap/networkColor";
import { formatMccMnc, getCarrierName } from "~/constants/mccMncCarriers";
import * as Schema from "~/database/schema.d";
import type { Route } from "./+types/signal";

export const meta: MetaFunction = () => {
  return [{ title: "Signal map" }];
};

const SIGNAL_DBM_PATH = '$."other"."gsm.signal.dbm"';
const MCC_PATH = '$."other"."gsm.mcc"';
const MNC_PATH = '$."other"."gsm.mnc"';

export async function loader({ context }: Route.LoaderArgs) {
  const { urlDate, password, deviceId } = getPasswordRouteAccess(context);
  const db = getDb(context);

  const signalValue = sql<number>`json_extract(${Schema.Events.data}, ${SIGNAL_DBM_PATH})`;

  const signalRows = await db
    .select({
      h3Index: Schema.Events.h3Index,
      latitude: sql<number>`AVG(${Schema.Events.latitude})`.as("latitude"),
      longitude: sql<number>`AVG(${Schema.Events.longitude})`.as("longitude"),
      avgDbm: sql<number>`AVG(${signalValue})`.as("avg_dbm"),
      readingCount: sql<number>`COUNT(*)`.as("reading_count"),
    })
    .from(Schema.Events)
    .where(
      and(
        eq(Schema.Events.deviceId, deviceId),
        eq(Schema.Events.dateString, urlDate),
        sql`${signalValue} IS NOT NULL`,
      ),
    )
    .groupBy(Schema.Events.h3Index);

  const mccValue = sql<string>`json_extract(${Schema.Events.data}, ${MCC_PATH})`;
  const mncValue = sql<string>`json_extract(${Schema.Events.data}, ${MNC_PATH})`;

  const networkCounts = db.$with("network_counts").as(
    db
      .select({
        h3Index: Schema.Events.h3Index,
        mcc: mccValue.as("mcc"),
        mnc: mncValue.as("mnc"),
        latitude: sql<number>`AVG(${Schema.Events.latitude})`.as("latitude"),
        longitude: sql<number>`AVG(${Schema.Events.longitude})`.as("longitude"),
        count: sql<number>`COUNT(*)`.as("count"),
      })
      .from(Schema.Events)
      .where(
        and(
          eq(Schema.Events.deviceId, deviceId),
          eq(Schema.Events.dateString, urlDate),
          sql`${mccValue} IS NOT NULL`,
          sql`${mncValue} IS NOT NULL`,
        ),
      )
      .groupBy(Schema.Events.h3Index, sql`mcc`, sql`mnc`),
  );

  const rankedNetworkCounts = db.$with("ranked_network_counts").as(
    db
      .select({
        h3Index: networkCounts.h3Index,
        mcc: networkCounts.mcc,
        mnc: networkCounts.mnc,
        latitude: networkCounts.latitude,
        longitude: networkCounts.longitude,
        count: networkCounts.count,
        rank: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${networkCounts.h3Index} ORDER BY ${networkCounts.count} DESC)`.as(
          "rank",
        ),
      })
      .from(networkCounts),
  );

  const networkRows = await db
    .with(networkCounts, rankedNetworkCounts)
    .select({
      h3Index: rankedNetworkCounts.h3Index,
      mcc: rankedNetworkCounts.mcc,
      mnc: rankedNetworkCounts.mnc,
      latitude: rankedNetworkCounts.latitude,
      longitude: rankedNetworkCounts.longitude,
      readingCount: rankedNetworkCounts.count,
    })
    .from(rankedNetworkCounts)
    .where(eq(rankedNetworkCounts.rank, 1));

  return {
    urlDate,
    password,
    signalCells: signalRows.map((row) => ({
      h3Index: row.h3Index,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      avgDbm: Number(row.avgDbm),
      readingCount: Number(row.readingCount),
    })),
    networkCells: networkRows.map((row) => ({
      h3Index: row.h3Index,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      mcc: String(row.mcc),
      mnc: String(row.mnc),
      readingCount: Number(row.readingCount),
    })),
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const hasSignalData = loaderData.signalCells.length > 0;
  const hasNetworkData = loaderData.networkCells.length > 0;

  const signalRange = getSignalRange(
    loaderData.signalCells.map((cell) => cell.avgDbm),
  );
  const signalLegendTicks = hasSignalData
    ? buildSignalLegendTicks(signalRange, 5)
    : [];
  const signalHexCells: HexCell[] = loaderData.signalCells.map((cell) => ({
    h3Index: cell.h3Index,
    latitude: cell.latitude,
    longitude: cell.longitude,
    color: signalToColor(cell.avgDbm, signalRange),
    popup: (
      <>
        {cell.avgDbm.toFixed(0)} dBm
        <br />
        {cell.readingCount} reading{cell.readingCount === 1 ? "" : "s"}
      </>
    ),
  }));

  const networkTotals = new Map<
    string,
    { mcc: string; mnc: string; total: number }
  >();
  for (const cell of loaderData.networkCells) {
    const key = formatMccMnc(cell.mcc, cell.mnc);
    const existing = networkTotals.get(key);
    if (existing) {
      existing.total += cell.readingCount;
    } else {
      networkTotals.set(key, {
        mcc: cell.mcc,
        mnc: cell.mnc,
        total: cell.readingCount,
      });
    }
  }
  const sortedNetworkEntries = [...networkTotals.entries()].sort(
    (a, b) => b[1].total - a[1].total,
  );
  const networkColorByKey = assignNetworkColors(
    sortedNetworkEntries.map(([key]) => key),
  );
  const networkHexCells: HexCell[] = loaderData.networkCells.map((cell) => {
    const key = formatMccMnc(cell.mcc, cell.mnc);
    const color = networkColorByKey.get(key) ?? "#495057";
    return {
      h3Index: cell.h3Index,
      latitude: cell.latitude,
      longitude: cell.longitude,
      color,
      popup: (
        <>
          {getCarrierName(cell.mcc, cell.mnc)}
          <br />
          {cell.readingCount} reading{cell.readingCount === 1 ? "" : "s"}
        </>
      ),
    };
  });

  return (
    <Container fluid p="md">
      <Stack gap="md">
        <Card withBorder>
          <Group justify="space-between" align="center" mb="md">
            <div>
              <Title order={2}>Signal strength heatmap</Title>
              <Text c="dimmed" size="sm">
                Each cell shows the average GSM signal strength for the day: red
                is weak, green is strong.
              </Text>
            </div>
          </Group>
          {hasSignalData ? (
            <SignalMap cells={signalHexCells} />
          ) : (
            <Center py="xl">
              <Title order={3}>
                No GSM signal data recorded for this day yet
              </Title>
            </Center>
          )}
          {hasSignalData && (
            <Stack gap="xs" mt="md">
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
                {signalLegendTicks.map((tick) => (
                  <Group key={tick.dbm} gap="xs" wrap="nowrap">
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 999,
                        backgroundColor: tick.color,
                        flexShrink: 0,
                      }}
                    />
                    <Text size="sm">{tick.dbm.toFixed(0)} dBm</Text>
                  </Group>
                ))}
              </SimpleGrid>
              <Text c="dimmed" size="xs">
                Min {signalRange.minDbm.toFixed(0)} dBm, max{" "}
                {signalRange.maxDbm.toFixed(0)} dBm.
              </Text>
            </Stack>
          )}
        </Card>

        <Card withBorder>
          <Group justify="space-between" align="center" mb="md">
            <div>
              <Title order={2}>Mobile network coverage</Title>
              <Text c="dimmed" size="sm">
                Each cell is coloured by the mobile network most often in use
                there for the day.
              </Text>
            </div>
          </Group>
          {hasNetworkData ? (
            <SignalMap cells={networkHexCells} />
          ) : (
            <Center py="xl">
              <Title order={3}>No network data recorded for this day yet</Title>
            </Center>
          )}
          {hasNetworkData && (
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs" mt="md">
              {sortedNetworkEntries.map(([key, entry]) => (
                <Group key={key} gap="xs" wrap="nowrap">
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 999,
                      backgroundColor: networkColorByKey.get(key),
                      flexShrink: 0,
                    }}
                  />
                  <Text size="sm">
                    {getCarrierName(entry.mcc, entry.mnc)} ({entry.total})
                  </Text>
                </Group>
              ))}
            </SimpleGrid>
          )}
        </Card>
      </Stack>
    </Container>
  );
}
