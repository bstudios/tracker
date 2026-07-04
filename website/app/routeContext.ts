import type { DrizzleD1Database } from "drizzle-orm/d1";
import { createContext, type RouterContextProvider } from "react-router";
import type * as schema from "~/database/schema.d";

export const cloudflareContext = createContext<{
  env: Env;
  ctx: ExecutionContext;
}>();

export const dbContext = createContext<DrizzleD1Database<typeof schema>>();

export function getDb(context: Pick<RouterContextProvider, "get">) {
  return context.get(dbContext);
}
