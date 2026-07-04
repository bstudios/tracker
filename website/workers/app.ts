import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { createRequestHandler, RouterContextProvider } from "react-router";
import { drizzleLogger } from "../database/logger";
import * as schema from "../database/schema.d";
import { cloudflareContext, dbContext } from "../app/routeContext";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const db: DrizzleD1Database<typeof schema> = drizzle(env.DB, {
      schema,
      logger: drizzleLogger,
    });
    const routerContext = new RouterContextProvider();
    routerContext.set(cloudflareContext, { env, ctx });
    routerContext.set(dbContext, db);

    return requestHandler(request, routerContext);
  },
  async scheduled(event, env, ctx) {
    const db = drizzle(env.DB, {
      schema,
      logger: drizzleLogger,
    });
    console.log("Scheduled event", event);
  },
} satisfies ExportedHandler<Env>;
