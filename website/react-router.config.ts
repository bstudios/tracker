import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // return a list of URLs to prerender at build time
  /*async prerender() {
    return ["/", "/about", "/contact"];
  },*/
  future: {
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
