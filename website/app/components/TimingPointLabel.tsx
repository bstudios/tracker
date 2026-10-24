import { Badge, Group, Stack, Text, type MantineColor } from "@mantine/core";

// Badges named after a colour ("Blue route") are shown in that colour.
const BADGE_COLORS: MantineColor[] = [
  "red",
  "pink",
  "grape",
  "violet",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "green",
  "lime",
  "yellow",
  "orange",
];

const badgeColor = (badge: string): MantineColor => {
  const words = badge.toLowerCase().split(/\W+/);
  if (words.includes("purple")) return "grape";
  return BADGE_COLORS.find((color) => words.includes(color)) ?? "gray";
};

/**
 * Badges come back from the database already decoded, but go through a CTE on some
 * pages, so accept the raw JSON string as well.
 */
export const normaliseBadges = (badges: unknown): string[] => {
  if (Array.isArray(badges)) return badges.map(String);
  if (typeof badges === "string" && badges.length > 0) {
    try {
      const parsed = JSON.parse(badges);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
};

/** A timing point's name, followed by its badges, with its description beneath. */
export const TimingPointLabel = (props: {
  name: React.ReactNode;
  badges: string[];
  description: string | null;
}) => (
  <Stack gap={2}>
    <Group gap="xs" wrap="wrap">
      {props.name}
      {props.badges.map((badge) => (
        <Badge key={badge} size="sm" variant="light" color={badgeColor(badge)}>
          {badge}
        </Badge>
      ))}
    </Group>
    {props.description && (
      <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-line" }}>
        {props.description}
      </Text>
    )}
  </Stack>
);
