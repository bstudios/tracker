import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { createRequestHandler } from "react-router";
import { drizzleLogger } from "../database/logger";
import * as schema from "../database/schema.d";
import { enforceCloudflareAccessOnAdminRoutes } from "./cloudflareAccessAdminMiddleware";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
    db: DrizzleD1Database<typeof schema>;
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    const accessResponse = await enforceCloudflareAccessOnAdminRoutes(
      request,
      env
    );
    if (accessResponse) {
      return accessResponse;
    }

    const db = drizzle(env.DB, {
      schema,
      logger: drizzleLogger,
    });
    return requestHandler(request, {
      cloudflare: { env, ctx },
      db,
    });
  },
  async scheduled(event, env, ctx) {
    const db = drizzle(env.DB, {
      schema,
      logger: drizzleLogger,
    });
    console.log("Scheduled event", event);
  },
} satisfies ExportedHandler<Env>;
