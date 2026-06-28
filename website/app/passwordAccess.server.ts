import { sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { redirect } from "react-router";
import { AccessPasswords } from "~/database/schema/AccessPasswords";
import type { Route as MapRoute } from "./routes/+types/map";

type TrackerDb = MapRoute.LoaderArgs["context"]["db"];
const PASSWORD_PATTERN = /^[a-z0-9-]+$/;

const getRateLimitKey = (request: Request, prefix: string) => {
  const connectingIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  return `${prefix}:${connectingIp}`;
};

const enforceFailedPasswordRateLimit = async (request: Request, env: Env) => {
  const { success } = await env.TRACKER_PASSWORD_LOGIN_RATE_LIMITER.limit({
    key: getRateLimitKey(request, "password-access"),
  });
  if (!success) {
    throw new Response("Too many incorrect password attempts. Please try again shortly.", {
      status: 429,
    });
  }
};

const getReferenceDate = (dateParam?: string) => {
  const parsedDate = dateParam
    ? DateTime.fromFormat(dateParam, "yyyy-MM-dd", { zone: "utc" })
    : DateTime.now().toUTC();
  const safeDate = parsedDate.isValid ? parsedDate : DateTime.now().toUTC();
  return safeDate.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
};

const normalisePassword = (rawPassword: string) => rawPassword.trim().toLowerCase();

const isValidPassword = (password: string) => PASSWORD_PATTERN.test(password);

export const parsePasswordInput = (rawPassword: string) => {
  const normalisedPassword = normalisePassword(rawPassword);
  if (normalisedPassword.length === 0) {
    throw new Error("Password is required");
  }
  if (!isValidPassword(normalisedPassword)) {
    throw new Error(
      "Password can only include simple latin letters, numbers, and hyphens."
    );
  }
  return normalisedPassword;
};

const parsePasswordLookup = (rawPassword: string) => {
  const normalisedPassword = normalisePassword(rawPassword);
  if (!normalisedPassword || !isValidPassword(normalisedPassword)) {
    return null;
  }
  return normalisedPassword;
};

export const parseAllowedDatesInput = (rawAllowedDates: string) => {
  const normalisedValue = rawAllowedDates.trim();
  if (
    normalisedValue.length === 0 ||
    normalisedValue.toLowerCase() === "null"
  ) {
    return null;
  }

  if (normalisedValue.includes(",")) {
    throw new Error(
      "Only one allowed date is supported. Leave empty for unrestricted access."
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalisedValue)) {
    throw new Error("Allowed date must use yyyy-MM-dd format or be empty.");
  }

  const parsedDate = DateTime.fromFormat(normalisedValue, "yyyy-MM-dd", {
    zone: "utc",
  });
  if (!parsedDate.isValid) {
    throw new Error("Allowed date must be a valid calendar date.");
  }

  return [normalisedValue];
};

const normaliseAllowedDates = (allowedDates: string[] | null) => {
  if (allowedDates === null) {
    return null;
  }

  const cleanedDates = allowedDates.map((item) => item.trim()).filter(Boolean);
  if (cleanedDates.length === 0) {
    return [];
  }

  return [cleanedDates[0]];
};

export async function findPasswordAccess(db: TrackerDb, password: string) {
  const normalisedPassword = parsePasswordLookup(password);
  if (!normalisedPassword) {
    return null;
  }

  const [accessConfig] = await db
    .select({
      id: AccessPasswords.id,
      password: AccessPasswords.password,
      allowedDates: AccessPasswords.allowedDates,
    })
    .from(AccessPasswords)
    .where(sql`lower(${AccessPasswords.password}) = ${normalisedPassword}`)
    .limit(1);

  if (!accessConfig) {
    return null;
  }

  return {
    ...accessConfig,
    password: normalisedPassword,
    allowedDates: normaliseAllowedDates(accessConfig.allowedDates),
  };
}

export async function findPasswordAccessWithRateLimit(args: {
  db: TrackerDb;
  password: string;
  request: Request;
  env: Env;
}) {
  const accessConfig = await findPasswordAccess(args.db, args.password);
  if (accessConfig) {
    return accessConfig;
  }

  await enforceFailedPasswordRateLimit(args.request, args.env);
  return null;
}

export async function ensurePasswordAccess(args: {
  db: TrackerDb;
  password: string | undefined;
  dateParam?: string;
  request: Request;
  env: Env;
}) {
  if (!args.password) {
    throw redirect("/");
  }

  const accessConfig = await findPasswordAccessWithRateLimit({
    db: args.db,
    password: args.password,
    request: args.request,
    env: args.env,
  });
  if (!accessConfig) {
    throw redirect("/?error=invalid-password");
  }

  if (!args.dateParam) {
    if (accessConfig.allowedDates !== null && accessConfig.allowedDates.length === 1) {
      const allowedDate = accessConfig.allowedDates[0];
      const refDate = getReferenceDate(allowedDate);
      return {
        password: accessConfig.password,
        allowedDates: accessConfig.allowedDates,
        refDate,
        urlDate: refDate.toFormat("yyyy-MM-dd"),
      };
    }
    throw redirect(`/${encodeURIComponent(accessConfig.password)}`);
  }

  const refDate = getReferenceDate(args.dateParam);
  const urlDate = refDate.toFormat("yyyy-MM-dd");

  if (
    accessConfig.allowedDates !== null &&
    !accessConfig.allowedDates.includes(urlDate)
  ) {
    throw redirect(
      `/?error=date-not-allowed&date=${encodeURIComponent(urlDate)}`
    );
  }

  return {
    password: accessConfig.password,
    allowedDates: accessConfig.allowedDates,
    refDate,
    urlDate,
  };
}
