import type { Config } from "@react-router/dev/config";
import { sentryOnBuildEnd } from "@sentry/react-router";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // return a list of URLs to prerender at build time
  /*async prerender() {
    return ["/", "/about", "/contact"];
  },*/

  // Uploads the source maps to Sentry once both halves of the build have finished, which
  // is the only point at which the client and server maps both exist. It reads its
  // settings from the `sentryReactRouter` plugin in `vite.config.ts`, and is a no-op
  // unless `SENTRY_AUTH_TOKEN` is set — so a plain local build is unaffected.
  buildEnd: sentryOnBuildEnd,
} satisfies Config;
