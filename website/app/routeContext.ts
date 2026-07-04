import type { DrizzleD1Database } from "drizzle-orm/d1";
import { createContext, type RouterContextProvider } from "react-router";
import type { DateTime } from "luxon";
import type * as schema from "~/database/schema.d";

export const cloudflareContext = createContext<{
  env: Env;
  ctx: ExecutionContext;
}>();

export const dbContext = createContext<DrizzleD1Database<typeof schema>>();

export const passwordRouteAccessContext = createContext<{
  password: string;
  allowedDates: string[] | null;
  refDate: DateTime;
  urlDate: string;
}>();

export function getDb(context: Pick<RouterContextProvider, "get">) {
  return context.get(dbContext);
}

export function getPasswordRouteAccess(
  context: Pick<RouterContextProvider, "get">,
) {
  return context.get(passwordRouteAccessContext);
}
