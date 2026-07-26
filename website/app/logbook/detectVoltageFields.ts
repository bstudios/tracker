/**
 * Discovering which numeric fields a device actually reports.
 *
 * Voltage sources are configured by JSON path because only the tracker's internal battery
 * is mapped into a known field — a boat's engine/input voltage arrives as an unmapped
 * flespi key under `data.other`, and flespi may send it either as a nested object or as a
 * single flat key containing dots (`{"external.powersource.voltage": 13.8}`). Rather than
 * make the admin guess, the settings page samples recent events and lists what is there.
 */

/** How deep to walk into `events.data` before giving up. */
const MAX_DEPTH = 6;

export type DetectedNumericField = {
  /** A SQLite JSON path, ready to paste into a voltage source's `jsonPath`. */
  jsonPath: string;
  latestValue: number;
  minValue: number;
  maxValue: number;
};

/**
 * Quote one path segment for SQLite's JSON path syntax.
 *
 * Bare segments are only safe when they are simple identifiers; anything else — notably
 * flespi's flat dotted keys — has to be quoted or SQLite reads the dots as a descent into
 * nested objects that do not exist.
 */
export const quoteJsonPathSegment = (segment: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)
    ? segment
    : `"${segment.replace(/"/g, '\\"')}"`;

export const buildJsonPath = (segments: string[]) =>
  `$${segments.map((segment) => `.${quoteJsonPathSegment(segment)}`).join("")}`;

/**
 * Read a value out of an already-parsed event `data` object using a SQLite JSON path.
 *
 * Used so the logbook builder and the database agree on what a configured path means.
 * Only the subset of the syntax the settings page can produce is supported: a `$` root
 * followed by dot-separated, optionally quoted, object keys. Array indexing is not
 * supported, and an unparseable path yields `undefined` rather than throwing.
 */
export const readJsonPath = (source: unknown, jsonPath: string): unknown => {
  const trimmed = jsonPath.trim();
  if (!trimmed.startsWith("$")) return undefined;

  const segments: string[] = [];
  let index = 1;

  while (index < trimmed.length) {
    if (trimmed[index] !== ".") return undefined;
    index += 1;

    if (trimmed[index] === '"') {
      index += 1;
      let segment = "";
      while (index < trimmed.length && trimmed[index] !== '"') {
        if (trimmed[index] === "\\") index += 1;
        segment += trimmed[index];
        index += 1;
      }
      if (trimmed[index] !== '"') return undefined;
      index += 1;
      segments.push(segment);
      continue;
    }

    let segment = "";
    while (index < trimmed.length && trimmed[index] !== ".") {
      segment += trimmed[index];
      index += 1;
    }
    if (segment.length === 0) return undefined;
    segments.push(segment);
  }

  let current: unknown = source;
  for (const segment of segments) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

/**
 * List every numeric leaf across a sample of event `data` objects, newest first.
 *
 * Booleans are excluded: `true`/`false` are not numbers in JSON, but `charging` would
 * otherwise be tempting to band, and bands on a two-state field are meaningless.
 */
export const findNumericJsonPaths = (
  samples: unknown[],
): DetectedNumericField[] => {
  const found = new Map<string, DetectedNumericField>();

  const walk = (value: unknown, segments: string[], isNewest: boolean) => {
    if (segments.length > MAX_DEPTH) return;

    if (typeof value === "number" && Number.isFinite(value)) {
      const jsonPath = buildJsonPath(segments);
      const existing = found.get(jsonPath);
      if (!existing) {
        found.set(jsonPath, {
          jsonPath,
          latestValue: value,
          minValue: value,
          maxValue: value,
        });
        return;
      }
      // Samples arrive newest first, so the first value seen for a path is the latest.
      if (isNewest) existing.latestValue = value;
      existing.minValue = Math.min(existing.minValue, value);
      existing.maxValue = Math.max(existing.maxValue, value);
      return;
    }

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      walk(nested, [...segments, key], isNewest);
    }
  };

  samples.forEach((sample, index) => walk(sample, [], index === 0));

  return Array.from(found.values()).sort((a, b) =>
    a.jsonPath.localeCompare(b.jsonPath),
  );
};
