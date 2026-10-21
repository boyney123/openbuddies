// `pnpm watch`: run your real household (the one `openbuddies init` set up) from this checkout, picking up code changes
// as you work. The server restarts when its code changes (this runs under `tsx watch`) and the web app is rebuilt into
// dist/web when its code changes (refresh the phone or browser to see it). Nothing in the household is touched:
// children, paired devices, buddies and chats all carry over. Any OpenBuddies already running for the household is
// stopped first. Ctrl+C stops it; `openbuddies start` puts the normal background server back.
//
//   pnpm watch                     the household openbuddies would use (--home, $OPENBUDDIES_HOME, ~/.openbuddiesrc, ~/openbuddies)
//   pnpm watch --home <dir>        a specific one

import { join } from "node:path";
import { build, type Rollup } from "vite";
import { runningServer, stopServer } from "../src/cli/service.js";
import { loadHousehold, resolveHome } from "../src/server/config.js";
import { startServer } from "../src/server/index.js";
import { childBaseUrl } from "../src/server/network.js";

const arg = process.argv.indexOf("--home");
const explicit = arg > -1 ? process.argv[arg + 1] : undefined;
// An empty --home must not quietly fall back to the default household.
if (arg > -1 && !explicit?.trim()) {
  console.error("  --home needs a folder.");
  process.exit(1);
}
const home = resolveHome(explicit);
const { port } = loadHousehold(home).config;

if (await runningServer(port)) {
  console.log("  Stopping the OpenBuddies that's already running for this household…");
  if (!(await stopServer(home, port))) {
    console.error(`  Couldn't stop the server on port ${port}. Stop it yourself (openbuddies stop), then run pnpm watch again.`);
    process.exit(1);
  }
}

// The web app, rebuilt on change. Wait for the first build so the server never serves a half-written dist/web.
const watcher = (await build({ configFile: join(import.meta.dirname, "..", "vite.config.ts"), logLevel: "warn", build: { watch: {} } })) as Rollup.RollupWatcher;
await new Promise<void>((resolve) => {
  watcher.on("event", (e) => {
    if (e.code === "END") {
      resolve();
      console.log("  Web app rebuilt. Refresh to see it.");
    }
    if (e.code === "ERROR") console.error(`  Web build failed: ${e.error.message}`);
  });
});

const server = await startServer({ home });
const { base } = await childBaseUrl(server.port);
console.log(`\n  OpenBuddies (watch mode) for ${home}`);
console.log(`  Parent page:  http://localhost:${server.port}/parent`);
console.log(`  Child app:    ${base}/`);
console.log("  The server restarts when its code changes; the web app rebuilds. Ctrl+C to stop.\n");

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  // Open phones keep sockets alive, so don't wait on them for long.
  const settle = (p: Promise<unknown>) => Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
  await Promise.all([settle(watcher.close()), settle(server.close())]);
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
