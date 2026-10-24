import type { DrizzleD1Database } from "drizzle-orm/d1";
import { and, asc, desc, eq, inArray, lte, max } from "drizzle-orm";
import * as Schema from "~/database/schema.d";

/**
 * Reading and writing the crew aboard a device, as recorded in its logbook.
 *
 * A crew change is a whole crew from its timestamp onwards — see `LogbookCrewChanges`.
 */

export type CrewMember = { name: string; role: string };

export type CrewChange = {
  /** Unix milliseconds. */
  timestamp: number;
  members: CrewMember[];
};

/** How many past names and roles to offer as suggestions — enough for a season's crew. */
const MAX_SUGGESTIONS = 200;

/** "Alice (Skipper), Bob (Navigator), Carol" — the one-line form used in the log. */
export const formatCrew = (members: CrewMember[]) =>
  members
    .map(({ name, role }) => (role.length > 0 ? `${name} (${role})` : name))
    .join(", ");

const attachMembers = async (
  db: DrizzleD1Database<typeof Schema>,
  changes: { id: number; timestamp: number }[],
): Promise<CrewChange[]> => {
  if (changes.length === 0) return [];

  const members = await db
    .select({
      crewChangeId: Schema.LogbookCrewMembers.crewChangeId,
      name: Schema.LogbookCrewMembers.name,
      role: Schema.LogbookCrewMembers.role,
    })
    .from(Schema.LogbookCrewMembers)
    .where(
      inArray(
        Schema.LogbookCrewMembers.crewChangeId,
        changes.map((change) => change.id),
      ),
    )
    .orderBy(asc(Schema.LogbookCrewMembers.position));

  return changes.map((change) => ({
    timestamp: change.timestamp,
    members: members
      .filter((member) => member.crewChangeId === change.id)
      .map(({ name, role }) => ({ name, role })),
  }));
};

/** Every crew change filed against one day of a device's logbook, in time order. */
export async function loadCrewChangesForDay(
  db: DrizzleD1Database<typeof Schema>,
  args: { deviceId: number; dateString: string },
): Promise<CrewChange[]> {
  const changes = await db
    .select({
      id: Schema.LogbookCrewChanges.id,
      timestamp: Schema.LogbookCrewChanges.timestamp,
    })
    .from(Schema.LogbookCrewChanges)
    .where(
      and(
        eq(Schema.LogbookCrewChanges.deviceId, args.deviceId),
        eq(Schema.LogbookCrewChanges.dateString, args.dateString),
      ),
    )
    .orderBy(asc(Schema.LogbookCrewChanges.timestamp));

  return attachMembers(db, changes);
}

/**
 * What the "Crew change" form starts from: the crew most recently recorded up to the end of
 * `dateString` — usually only one or two people differ from it — plus every name and role
 * used on this device before, most recently used first, to suggest as they are typed.
 */
export async function loadCrewFormDefaults(
  db: DrizzleD1Database<typeof Schema>,
  args: { deviceId: number; dateString: string },
): Promise<{
  previousCrew: CrewMember[];
  nameSuggestions: string[];
  roleSuggestions: string[];
}> {
  const { deviceId, dateString } = args;

  const lastUsed = max(Schema.LogbookCrewChanges.timestamp);
  const suggestionsFor = (
    column:
      | typeof Schema.LogbookCrewMembers.name
      | typeof Schema.LogbookCrewMembers.role,
  ) =>
    db
      .select({ value: column })
      .from(Schema.LogbookCrewMembers)
      .innerJoin(
        Schema.LogbookCrewChanges,
        eq(
          Schema.LogbookCrewChanges.id,
          Schema.LogbookCrewMembers.crewChangeId,
        ),
      )
      .where(eq(Schema.LogbookCrewChanges.deviceId, deviceId))
      .groupBy(column)
      .orderBy(desc(lastUsed))
      .limit(MAX_SUGGESTIONS);

  const [latestChanges, names, roles] = await Promise.all([
    db
      .select({
        id: Schema.LogbookCrewChanges.id,
        timestamp: Schema.LogbookCrewChanges.timestamp,
      })
      .from(Schema.LogbookCrewChanges)
      .where(
        and(
          eq(Schema.LogbookCrewChanges.deviceId, deviceId),
          lte(Schema.LogbookCrewChanges.dateString, dateString),
        ),
      )
      .orderBy(
        desc(Schema.LogbookCrewChanges.dateString),
        desc(Schema.LogbookCrewChanges.timestamp),
      )
      .limit(1),
    suggestionsFor(Schema.LogbookCrewMembers.name),
    suggestionsFor(Schema.LogbookCrewMembers.role),
  ]);

  const [previous] = await attachMembers(db, latestChanges);

  return {
    previousCrew: previous?.members ?? [],
    nameSuggestions: names.map((row) => row.value),
    roleSuggestions: roles
      .map((row) => row.value)
      .filter((role) => role.length > 0),
  };
}

/** Record a new crew from `timestamp` onwards. */
export async function saveCrewChange(
  db: DrizzleD1Database<typeof Schema>,
  args: {
    deviceId: number;
    dateString: string;
    timestamp: number;
    members: CrewMember[];
  },
): Promise<void> {
  const [change] = await db
    .insert(Schema.LogbookCrewChanges)
    .values({
      deviceId: args.deviceId,
      dateString: args.dateString,
      timestamp: args.timestamp,
      createdAt: Date.now(),
    })
    .returning({ id: Schema.LogbookCrewChanges.id });

  try {
    await db.insert(Schema.LogbookCrewMembers).values(
      args.members.map((member, position) => ({
        crewChangeId: change.id,
        name: member.name,
        role: member.role,
        position,
      })),
    );
  } catch (error) {
    // A change with nobody on it would read as "everybody left the boat", so don't leave
    // one behind if the members could not be written.
    await db
      .delete(Schema.LogbookCrewChanges)
      .where(eq(Schema.LogbookCrewChanges.id, change.id));
    throw error;
  }
}
