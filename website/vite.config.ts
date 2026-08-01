import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" }
    }),
    reactRouter(),
    tsconfigPaths(),
  ],
  build: {
    rollupOptions: {
      output: {
        // React, react-router and Mantine's internals (which call React.createContext
        // at module scope) must never land in different chunks than React itself -
        // route-based code splitting can otherwise place them in chunks whose relative
        // load order Rollup gets wrong, producing a production-only
        // "Cannot read properties of undefined (reading 'createContext')" crash.
        manualChunks(id) {
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/") ||
            id.includes("node_modules/react-router/") ||
            id.includes("node_modules/@mantine/")
          ) {
            return "vendor-react";
          }
        },
      },
    },
  },
});
