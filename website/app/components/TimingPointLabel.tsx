import {
  Anchor,
  Badge,
  Group,
  Stack,
  Text,
  type MantineColor,
} from "@mantine/core";
import { IconCoffee, IconGasStation, IconTrain } from "@tabler/icons-react";
import { Link } from "react-router";

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

const TimingPointIcon = (props: { icon: string | null }) =>
  props.icon === "IconCoffee" ? (
    <IconCoffee />
  ) : props.icon === "IconGasStation" ? (
    <IconGasStation />
  ) : props.icon === "IconTrain" ? (
    <IconTrain />
  ) : null;

/**
 * A timing point's icon and name (linking to it on Google Maps), followed by its badges,
 * with its description beneath. Shared by every table that lists timing points so they
 * all read the same.
 */
export type TimingPointLabelProps = {
  name: string;
  icon: string | null;
  googleLink: string | null;
  latitude: number;
  longitude: number;
  badges: string[];
  description: string | null;
};

export const TimingPointLabel = (props: TimingPointLabelProps) => (
  <Stack gap={2}>
    <Group gap="xs" wrap="wrap">
      <TimingPointIcon icon={props.icon} />
      <Anchor
        c="inherit"
        inherit
        component={Link}
        to={
          props.googleLink ??
          `https://www.google.com/maps?q=${props.latitude},${props.longitude}`
        }
        target="_blank"
      >
        {props.name}
      </Anchor>
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
