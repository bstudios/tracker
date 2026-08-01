import { Button, Group } from "@mantine/core";
import { Link } from "react-router";

/**
 * `historic` has no button of its own — the comparison page is reached from the menu — but
 * it is still a value here so the layout can mark none of the buttons active while on it.
 */
export type DatePage =
  | "menu"
  | "live"
  | "logbook"
  | "timings"
  | "analysis"
  | "signal"
  | "historic"
  | "none";

interface DatePageNavProps {
  password: string;
  urlDate: string;
  current: DatePage;
}

const PAGES: Array<{ page: DatePage; label: string; path: string }> = [
  { page: "menu", label: "Menu", path: "" },
  { page: "live", label: "Live tracking map", path: "/live" },
  { page: "logbook", label: "Logbook", path: "/logbook" },
  { page: "timings", label: "Timing points", path: "/timings" },
  { page: "analysis", label: "Analysis", path: "/analysis" },
];

export function DatePageNav({ password, urlDate, current }: DatePageNavProps) {
  const basePath = `/${password}/${urlDate}`;

  return (
    <Group gap="xs">
      {PAGES.map(({ page, label, path }) => (
        <Button
          key={page}
          component={Link}
          to={`${basePath}${path}`}
          variant={current === page ? "filled" : "light"}
          size="compact-md"
        >
          {label}
        </Button>
      ))}
    </Group>
  );
}
