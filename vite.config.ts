import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath } from "node:url";

// SLAMS frontend — static SPA (deployed to Vercel).
// The backend is the Cloudflare Workers API in /worker (see wrangler.toml).
// During development the SPA talks to the API at VITE_API_URL
// (default http://localhost:8787, where `wrangler dev` serves it).
export default defineConfig({
  plugins: [
    // File-based router codegen (src/routes -> src/routeTree.gen.ts).
    // Must come first so the route tree exists before other plugins run.
    tanstackRouter({
      target: "react",
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      // Split each route into its own lazy chunk so students never download
      // the admin analytics bundle (recharts) and vice versa.
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    // Dev server only — the sandbox/browser preview reaches Vite through a
    // proxied host, so allow all hosts (no auth-sensitive surface here;
    // production is served statically by Vercel).
    allowedHosts: true,
    // In local dev the SPA calls same-origin /api and Vite forwards it to the
    // Worker (wrangler dev, :8787) server-side — no CORS setup needed in the
    // browser. Override with API_PROXY_TARGET if the Worker runs elsewhere.
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
