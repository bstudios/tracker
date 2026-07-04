import "@mantine/charts/styles.css";
import {
  AppShell,
  Button,
  ColorSchemeScript,
  Container,
  createTheme,
  Group,
  LoadingOverlay,
  MantineProvider,
  Text,
  Title,
  type MantineColorsTuple,
} from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigation,
} from "react-router";
import type { Route } from "./+types/root";

import type React from "react";
import classes from "./components/ErrorBoundary.module.css";

const myColor: MantineColorsTuple = [
  "#ffe9f0",
  "#ffd0dd",
  "#faa0b8",
  "#f66d90",
  "#f2426f",
  "#f1275a",
  "#f1184f",
  "#d70841",
  "#c00038",
  "#a9002f",
];

export const theme = createTheme({
  primaryColor: "pink",
  colors: {
    pink: myColor,
  },
  primaryShade: 3,
});

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <Meta />
        <Links />
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body>
        <MantineProvider theme={theme}>{children}</MantineProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const navigating = useNavigation();
  return (
    <AppShell header={{ height: 0 }} padding={0}>
      <AppShell.Main>
        <LoadingOverlay
          visible={navigating.state === "loading"}
          loaderProps={{ type: "oval", size: "xl" }}
        />
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}

export const links: Route.LinksFunction = () => [];

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Error";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }
  console.log(error); // Send error to CF workers dashboard

  return (
    <Container className={classes.root}>
      <Title className={classes.title}>{message}</Title>
      <Text c="dimmed" size="lg" ta="center" className={classes.details}>
        {import.meta.env.DEV ? stack : details}
      </Text>
      <Group justify="center">
        <Link reloadDocument to="/">
          <Button variant="subtle" size="md">
            Take me back to home page
          </Button>
        </Link>
      </Group>
    </Container>
  );
}
