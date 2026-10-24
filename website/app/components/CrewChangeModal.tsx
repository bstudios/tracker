import {
  ActionIcon,
  Autocomplete,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useState } from "react";
import { Form } from "react-router";
import { DISPLAY_TIME_ZONE } from "~/utils/dateTime";

type CrewMember = { name: string; role: string };

/** Rows need a stable key of their own — names are blank while typing and can repeat. */
type CrewRow = CrewMember & { key: number };

let nextRowKey = 0;
const toRows = (members: CrewMember[]): CrewRow[] =>
  (members.length > 0 ? members : [{ name: "", role: "" }]).map((member) => ({
    ...member,
    key: nextRowKey++,
  }));

/**
 * The form for recording who is aboard from a given time.
 *
 * Starts from the crew last recorded, since a change is usually one or two people swapping
 * rather than a whole new crew, and suggests every name and role used on this device before
 * so the same person is spelt the same way each time — which is what will let their own
 * history be looked up by name later.
 */
export function CrewChangeModal({
  opened,
  onClose,
  submitting,
  previousCrew,
  nameSuggestions,
  roleSuggestions,
}: {
  opened: boolean;
  onClose: () => void;
  submitting: boolean;
  previousCrew: CrewMember[];
  nameSuggestions: string[];
  roleSuggestions: string[];
}) {
  const [rows, setRows] = useState<CrewRow[]>(() => toRows(previousCrew));
  const [defaultTime, setDefaultTime] = useState("");

  // Reset each time the form opens, so it starts from the latest saved crew rather than
  // whatever was half-typed and cancelled last time.
  const [wasOpened, setWasOpened] = useState(false);
  if (opened !== wasOpened) {
    setWasOpened(opened);
    if (opened) {
      setRows(toRows(previousCrew));
      setDefaultTime(
        DateTime.now().setZone(DISPLAY_TIME_ZONE).toFormat("HH:mm"),
      );
    }
  }

  const updateRow = (key: number, change: Partial<CrewMember>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...change } : row)),
    );

  // Don't offer a name already on the list.
  const takenNames = new Set(rows.map((row) => row.name.trim()));

  return (
    <Modal opened={opened} onClose={onClose} title="Crew change" centered>
      <Form method="post" onSubmit={onClose}>
        <input type="hidden" name="intent" value="set-crew" />
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Records everyone aboard from the time given, until the next crew
            change. List the whole crew, not just who joined.
          </Text>
          <TextInput
            type="time"
            label="Time"
            name="time"
            defaultValue={defaultTime}
            key={defaultTime}
            required
          />
          <Stack gap="xs">
            {rows.map((row, index) => (
              <Group key={row.key} gap="xs" wrap="nowrap" align="flex-end">
                <Autocomplete
                  label={index === 0 ? "Name" : undefined}
                  aria-label="Name"
                  name="crewName"
                  value={row.name}
                  onChange={(name) => updateRow(row.key, { name })}
                  data={nameSuggestions.filter(
                    (name) => name === row.name || !takenNames.has(name),
                  )}
                  placeholder="Name"
                  style={{ flex: 3 }}
                  data-autofocus={index === 0 ? true : undefined}
                />
                <Autocomplete
                  label={index === 0 ? "Role" : undefined}
                  aria-label="Role"
                  name="crewRole"
                  value={row.role}
                  onChange={(role) => updateRow(row.key, { role })}
                  data={roleSuggestions}
                  placeholder="Role (optional)"
                  style={{ flex: 2 }}
                />
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  aria-label="Remove from crew"
                  disabled={rows.length === 1}
                  onClick={() =>
                    setRows((current) =>
                      current.filter((other) => other.key !== row.key),
                    )
                  }
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
            <Group>
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<IconPlus size={14} />}
                onClick={() =>
                  setRows((current) => [...current, ...toRows([])])
                }
                type="button"
              >
                Add person
              </Button>
            </Group>
          </Stack>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Save crew
            </Button>
          </Group>
        </Stack>
      </Form>
    </Modal>
  );
}
