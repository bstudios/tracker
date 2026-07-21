import { getDb } from "~/routeContext";
import { Button, Center, Stack, Title } from "@mantine/core";
import { desc, eq } from "drizzle-orm";
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

export default function Page({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();

  return (
    <Center>
      <Stack py="xl" px="xl">
        <Title order={1}>Select a date</Title>
        {loaderData.availableDates.length === 0 ? (
          <Title order={3}>No data available yet</Title>
        ) : (
          loaderData.availableDates.map((date) => (
            <Button
              key={date}
              onClick={() => navigate(`/${loaderData.password}/${date}`)}
            >
              {date}
            </Button>
          ))
        )}
      </Stack>
    </Center>
  );
}
