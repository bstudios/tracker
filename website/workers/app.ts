import { instrumentWorkflowWithSentry, withSentry } from "@sentry/cloudflare";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { createRequestHandler, RouterContextProvider } from "react-router";
import { drizzleLogger } from "../database/logger";
import * as schema from "../database/schema.d";
import { cloudflareContext, dbContext } from "../app/routeContext";
import { sentryOptions } from "../app/utils/sentry.server";
import { DailyLogbookEmailWorkflow as UninstrumentedDailyLogbookEmailWorkflow } from "./logbookEmailWorkflow";

// Workflow classes have to be exported from the worker's entry module for the runtime to
// find them. The nightly run is driven by `schedules` on its wrangler binding, so there is
// no `scheduled()` handler here.
//
// A Workflow runs outside any request, so `withSentry` below never sees it — it needs its
// own wrapper to get a Sentry scope, and one trace per workflow instance rather than per
// step. The type alias keeps the name usable in type position as well as value position,
// which is what `wrangler types` generates against for the `DAILY_LOGBOOK_EMAIL` binding.
export const DailyLogbookEmailWorkflow = instrumentWorkflowWithSentry(
  sentryOptions,
  UninstrumentedDailyLogbookEmailWorkflow,
);
export type DailyLogbookEmailWorkflow = UninstrumentedDailyLogbookEmailWorkflow;

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

// `withSentry` initialises the SDK per request and wraps `fetch`, which gives us the
// request span every other span hangs off, unhandled errors, and automatic spans for the
// D1 binding. The route name on that span is filled in later, by `wrapSentryHandleRequest`
// in `app/entry.server.tsx`, because only React Router knows which route matched.
export default withSentry(sentryOptions, {
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
} satisfies ExportedHandler<Env>);
