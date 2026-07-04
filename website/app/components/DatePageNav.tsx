import { Button, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { Link } from "react-router";

export type DatePage =
  "menu" | "live" | "timings" | "analysis" | "historic" | "none";

interface DatePageNavProps {
  password: string;
  urlDate: string;
  current: DatePage;
}

export function DatePageNav({ password, urlDate, current }: DatePageNavProps) {
  const basePath = `/${password}/${urlDate}`;

  return (
    <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="xs">
      <Button
        component={Link}
        to={basePath}
        variant={current === "menu" ? "filled" : "light"}
        fullWidth
      >
        Menu
      </Button>
      <Button
        component={Link}
        to={`${basePath}/live`}
        variant={current === "live" ? "filled" : "light"}
        fullWidth
      >
        Live tracking map
      </Button>
      <Button
        component={Link}
        to={`${basePath}/timings`}
        variant={current === "timings" ? "filled" : "light"}
        fullWidth
      >
        Timing points
      </Button>
      <Button
        component={Link}
        to={`${basePath}/analysis`}
        variant={current === "analysis" ? "filled" : "light"}
        fullWidth
      >
        Analysis
      </Button>
    </SimpleGrid>
  );
}
