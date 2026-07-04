import {
  Anchor,
  Button,
  Container,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  Form,
  Link,
  redirect,
  useLoaderData,
  type MetaFunction,
} from "react-router";
import {
  findPasswordAccessWithRateLimit,
  parsePasswordInput,
} from "~/passwordAccess.server";
import type { Route } from "./+types/login";

export const meta: MetaFunction = () => {
  return [{ title: "Login" }];
};

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const date = url.searchParams.get("date");
  return {
    error,
    date,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const formData = await request.formData();
  const rawPassword = (formData.get("password") as string | null) ?? "";
  let password = "";
  try {
    password = parsePasswordInput(rawPassword);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid password.";
    return { error: message };
  }

  const accessConfig = await findPasswordAccessWithRateLimit({
    password,
    request,
  });
  if (!accessConfig) {
    return { error: "Invalid password." };
  }

  if (
    accessConfig.allowedDates !== null &&
    accessConfig.allowedDates.length === 1
  ) {
    return redirect(
      `/${encodeURIComponent(accessConfig.password)}/${encodeURIComponent(accessConfig.allowedDates[0])}`,
    );
  }

  return redirect(`/${encodeURIComponent(accessConfig.password)}`);
}

export default function Page({ actionData }: Route.ComponentProps) {
  const loaderData = useLoaderData<typeof loader>();

  const errorMessage =
    actionData?.error ??
    (loaderData.error === "invalid-password"
      ? "The password is invalid."
      : loaderData.error === "date-not-allowed"
        ? `This password cannot access ${loaderData.date ?? "that date"}.`
        : undefined);

  return (
    <Container size="xs" py="xl">
      <Stack>
        <Title order={1}>Tracker Login</Title>
        <Text c="dimmed">Enter password to open tracking data.</Text>
        {errorMessage && <Text c="red">{errorMessage}</Text>}
        <Form method="post">
          <Stack>
            <TextInput
              label="Password"
              name="password"
              placeholder="Enter password"
              description="Letters, numbers, and hyphens only. Not case-sensitive."
              pattern="[A-Za-z0-9-]+"
              required
              autoComplete="off"
            />
            <Button type="submit">Open Tracker</Button>
          </Stack>
        </Form>
        <Text size="xs" c="dimmed" ta="center">
          <Anchor component={Link} to="/admin" c="dimmed">
            Admin
          </Anchor>
        </Text>
      </Stack>
    </Container>
  );
}
