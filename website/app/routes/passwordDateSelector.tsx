import { getDb } from "~/routeContext";
import { Accordion, Button, Container, Stack, Title } from "@mantine/core";
import { desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { redirect, useNavigate, type MetaFunction } from "react-router";
import { findPasswordAccessWithRateLimit } from "~/passwordAccess.server";
import * as Schema from "~/database/schema.d";
import type { Route } from "./+types/passwordDateSelector";

export const meta: MetaFunction = () => {
  return [{ title: "Select date" }];
};

export async function loader({ context, params, request }: Route.LoaderArgs) {
  if (!params.password) {
    throw redirect("/");
  }

  const accessConfig = await findPasswordAccessWithRateLimit({
    password: params.password,
    request,
  });
  if (!accessConfig) {
    throw redirect("/?error=invalid-password");
  }

  if (
    accessConfig.allowedDates !== null &&
    accessConfig.allowedDates.length === 1
  ) {
    throw redirect(
      `/${encodeURIComponent(accessConfig.password)}/${accessConfig.allowedDates[0]}`,
    );
  }

  const availableDateRows = await getDb(context)
    .select({
      date: Schema.Events.dateString,
    })
    .from(Schema.Events)
    .where(eq(Schema.Events.deviceId, accessConfig.deviceId))
    .groupBy(Schema.Events.dateString)
    .orderBy(desc(Schema.Events.dateString));

  const availableDates =
    accessConfig.allowedDates === null
      ? availableDateRows.map((row) => row.date)
      : availableDateRows
          .map((row) => row.date)
          .filter((date) => accessConfig.allowedDates?.includes(date));

  return {
    password: accessConfig.password,
    availableDates,
  };
}

function groupDatesByMonth(dates: string[]) {
  const months = new Map<string, string[]>();
  for (const date of dates) {
    const month = date.slice(0, 7);
    if (!months.has(month)) {
      months.set(month, []);
    }
    months.get(month)!.push(date);
  }
  return months;
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const today = DateTime.utc().toFormat("yyyy-MM-dd");
  const currentMonth = DateTime.utc().toFormat("yyyy-MM");
  const monthGroups = groupDatesByMonth(loaderData.availableDates);

  return (
    <Container p="md">
      <Stack py="xl" px="xl">
        <Title order={1}>Select a date</Title>
        {loaderData.availableDates.length === 0 ? (
          <Title order={3}>No data available yet</Title>
        ) : (
          <Accordion variant="contained" defaultValue={currentMonth}>
            {[...monthGroups.entries()].map(([month, monthDates]) => (
              <Accordion.Item key={month} value={month}>
                <Accordion.Control>
                  {DateTime.fromFormat(month, "yyyy-MM", {
                    zone: "utc",
                  }).toFormat("LLLL yyyy")}
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="xs">
                    {monthDates.map((date) => (
                      <Button
                        key={date}
                        variant={date === today ? "filled" : "light"}
                        onClick={() =>
                          navigate(`/${loaderData.password}/${date}`)
                        }
                      >
                        {DateTime.fromFormat(date, "yyyy-MM-dd", {
                          zone: "utc",
                        }).toFormat("cccc d LLL")}
                      </Button>
                    ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
      </Stack>
    </Container>
  );
}
