import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

// The frontend is a static single-page app deployed to Vercel. All backend work
// happens in the Cloudflare Worker, which is reached through the `/api` rewrite
// declared in vercel.json (and the dev proxy below), so the browser always sees
// same-origin requests and no third-party cookie is ever involved.
export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  server: {
    host: "0.0.0.0",
    port: 3000,
    // Sandbox/preview hosts are proxied, so allow the forwarded host header.
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_PROXY ?? "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
  preview: { host: "0.0.0.0", port: 3000, allowedHosts: true },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split the heaviest optional libraries so the initial route payload
        // stays small; reports and the QR scanner load only where used.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (id.includes("@tanstack")) return "tanstack";
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          return undefined;
        },
      },
    },
  },
});
