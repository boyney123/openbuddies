import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The OpenBuddies server the dev UI talks to (`pnpm demo` points this at its own server).
const api = `localhost:${process.env.OPENBUDDIES_API_PORT ?? 4747}`;

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) } },
  // One bundle is fine: it's served from the home machine, over the home network or Tailscale.
  build: { outDir: "../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://${api}`,
      "/ws": { target: `ws://${api}`, ws: true },
    },
  },
});
