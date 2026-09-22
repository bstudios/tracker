import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { sentryReactRouter } from "@sentry/react-router";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Source maps are only built when there is somewhere to send them.
 *
 * Uploading to Sentry needs credentials that only the deploy has, so the presence of
 * `SENTRY_AUTH_TOKEN` is what switches the whole thing on rather than a separate flag —
 * a plain local `npm run build` then behaves exactly as it did before.
 *
 * This gates map *generation*, not just upload. `build/client/` is served verbatim as the
 * site's static assets, so a `.map` left behind there is a public copy of the source; the
 * Sentry plugin only deletes maps on a build that uploaded them, and would otherwise turn
 * generation on for every build and leave them lying in the output.
 */
const uploadSourceMapsToSentry = Boolean(process.env.SENTRY_AUTH_TOKEN);

/**
 * The name the uploaded maps are filed under, which has to be the same string the running
 * worker reports as its release or the Sentry releases page lists builds with no events
 * beside events with no build. The deploy sets it to the commit SHA; see
 * `.github/workflows/cloudflare-workers-deploy.yml`.
 *
 * Note that stack traces resolve either way — the plugin stamps a debug id into every
 * bundle and its map, and Sentry matches on that rather than on the release.
 */
const sentryRelease = process.env.SENTRY_RELEASE;

export const sentryBuildOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  release: { name: sentryRelease },
  sourcemaps: {
    disable: !uploadSourceMapsToSentry,
    // Only the browser half is cleaned up. `build/server/` is never served to anyone, and
    // its maps have to survive this step so that `wrangler deploy` can upload them to
    // Cloudflare as well (`upload_source_maps` in wrangler.jsonc) and un-minify the
    // Workers dashboard's own stack traces.
    filesToDeleteAfterUpload: ["build/client/**/*.map"],
  },
};

export default defineConfig((config) => ({
  build: {
    // "hidden" emits the maps without a `sourceMappingURL` comment pointing at them, so
    // the browser never goes looking for a file that is about to be deleted.
    sourcemap: uploadSourceMapsToSentry ? ("hidden" as const) : false,
  },
  define: {
    // The worker cannot read the build environment at runtime, so the release name is
    // baked in here for `app/utils/sentry.server.ts` to report.
    "import.meta.env.VITE_SENTRY_RELEASE": JSON.stringify(sentryRelease ?? ""),
  },
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
    }),
    reactRouter(),
    tsconfigPaths(),
    sentryReactRouter(sentryBuildOptions, config),
  ],
}));
