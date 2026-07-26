import { Button, Card, Group, Slider, Text } from "@mantine/core";
import { IconPlayerTrackNext } from "@tabler/icons-react";
import { DISPLAY_TIME_ZONE, displayDateTime, formatTime24 } from "~/utils/dateTime";

/**
 * The bar along the bottom of the live map for stepping back through the day.
 *
 * Its value is a unix millisecond timestamp rather than an index into the track. The live
 * map revalidates every 60 seconds and replaces its points wholesale, so an index would
 * quietly come to mean a different moment each time new fixes arrive.
 */

export type ScrubberPoint = {
  latitude: number;
  longitude: number;
  /** Unix milliseconds, already normalised. */
  timestampMillis: number;
};

/** At most this many hour labels under the track, so they stay readable on a phone. */
const MAX_MARKS = 6;

/**
 * Hour boundaries inside the range, thinned to at most `MAX_MARKS`.
 *
 * Stepping in whole hours of the *display* zone rather than dividing the range evenly, so
 * the labels land on 09:00 rather than 09:07.
 */
const buildMarks = (fromMillis: number, toMillis: number) => {
  const first = displayDateTime(fromMillis).startOf("hour").plus({ hours: 1 });
  const hours: number[] = [];

  for (
    let at = first;
    at.toMillis() <= toMillis;
    at = at.plus({ hours: 1 })
  ) {
    hours.push(at.toMillis());
  }

  const stride = Math.ceil(hours.length / MAX_MARKS) || 1;
  return hours
    .filter((_, index) => index % stride === 0)
    .map((value) => ({ value, label: formatTime24(value) }));
};

export function TimeScrubber(props: {
  points: ScrubberPoint[];
  /** `null` means "following the latest fix" rather than a chosen moment. */
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const { points, value, onChange } = props;
  if (points.length < 2) return null;

  const fromMillis = points[0].timestampMillis;
  const toMillis = points[points.length - 1].timestampMillis;
  const isFollowingLatest = value === null;

  return (
    <Card withBorder p="xs" radius="md" shadow="sm">
      <Group gap="sm" wrap="nowrap" align="center">
        <Text size="sm" fw={600} miw={52} ta="right">
          {formatTime24(value ?? toMillis)}
        </Text>

        <Slider
          flex={1}
          min={fromMillis}
          max={toMillis}
          // One second. The slider is in epoch milliseconds, so without a step this size
          // the handle would try to address every millisecond of the day.
          step={1000}
          value={value ?? toMillis}
          onChange={onChange}
          label={formatTime24}
          labelAlwaysOn={false}
          marks={buildMarks(fromMillis, toMillis)}
          // Leave room for the mark labels, which render below the track.
          mb="lg"
          size="sm"
          thumbSize={18}
        />

        <Button
          size="compact-sm"
          variant={isFollowingLatest ? "light" : "filled"}
          leftSection={<IconPlayerTrackNext size={14} />}
          onClick={() => onChange(null)}
          disabled={isFollowingLatest}
        >
          Latest
        </Button>
      </Group>
      <Text size="xs" c="dimmed" ta="center">
        Drag to see where the tracker was ({DISPLAY_TIME_ZONE.replace("_", " ")})
      </Text>
    </Card>
  );
}

/**
 * The last fix at or before `atMillis`.
 *
 * Binary search rather than a scan because this runs on every frame of a drag, over a
 * day's worth of fixes. Returns the first point when the value predates the whole track,
 * which only happens transiently while the range is being re-established after a refresh.
 */
export const findPointAt = (
  points: ScrubberPoint[],
  atMillis: number,
): ScrubberPoint | null => {
  if (points.length === 0) return null;

  let low = 0;
  let high = points.length - 1;
  let found = 0;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (points[middle].timestampMillis <= atMillis) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return points[found];
};
