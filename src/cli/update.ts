// `openbuddies update`: move to the latest version without losing anything. It stops the server, keeps a copy of the
// household, installs the new version, and starts it again. If the new version doesn't come up, it puts the previous
// version and the copy back, so the family is never left without a working OpenBuddies.
//
// performUpdate holds the steps, with installing, starting and stopping passed in, so it can be tested; runUpdate adds
// the prompts and the real npm and server. Everything is imported up front: npm replaces this code on disk mid-run.

import * as p from "@clack/prompts";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DEFAULT_PORT, loadHousehold } from "../server/config.js";
import { packageRoot } from "../server/paths.js";
import { assertHousehold } from "./reset.js";
import { runningServer, serverLogPath, stopServer } from "./service.js";

export const RELEASES_URL = "https://github.com/boyney123/openbuddies/releases";
/** How many pre-update copies of the household to keep. Older ones are deleted after a successful update. */
export const KEEP_BACKUPS = 3;

/** How this copy of OpenBuddies was installed: a global npm install (the installer or `npm install -g`) under a prefix, or a source checkout. */
export function installKind(root: string): { kind: "npm"; prefix: string } | { kind: "source" } | { kind: "other" } {
  if (basename(root) === "openbuddies" && basename(dirname(root)) === "node_modules" && basename(dirname(dirname(root))) === "lib") {
    return { kind: "npm", prefix: dirname(dirname(dirname(root))) };
  }
  if (existsSync(join(root, ".git")) || existsSync(join(root, "src", "cli"))) return { kind: "source" };
  return { kind: "other" };
}

/** Whether version a is newer than b. Plain x.y.z; a pre-release (0.0.0-stage) counts as older than its release. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const [main, pre] = v.split("-", 2);
    return { nums: main.split(".").map((n) => Number(n) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) > (y.nums[i] ?? 0);
  return x.pre === null && y.pre !== null;
}

/** A sibling folder for the pre-update copy, e.g. ~/openbuddies-before-0.1.2-2026-10-21T18-05-00. */
export function updateBackupPath(dir: string, to: string, now = new Date()): string {
  return join(dirname(dir), `${basename(dir)}-before-${to}-${now.toISOString().slice(0, 19).replace(/:/g, "-")}`);
}

/** Delete all but the newest `keep` pre-update copies of this household. Returns what was deleted. */
export function pruneUpdateBackups(dir: string, keep = KEEP_BACKUPS): string[] {
  const prefix = `${basename(dir)}-before-`;
  const copies = readdirSync(dirname(dir))
    .filter((n) => n.startsWith(prefix) && /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(n))
    .sort((a, b) => a.slice(-19).localeCompare(b.slice(-19)));
  const gone = copies.slice(0, Math.max(0, copies.length - keep)).map((n) => join(dirname(dir), n));
  for (const g of gone) rmSync(g, { recursive: true, force: true });
  return gone;
}

export interface UpdateSteps {
  /** Install this version of OpenBuddies. */
  install(version: string): { ok: boolean; output: string };
  /** Start the server with whatever is installed now; ok once it answers. */
  start(): { ok: boolean; output: string };
  stop(): Promise<boolean>;
  /** The version the running server reports, or null if none is running. */
  runningVersion(): Promise<string | null>;
  log(msg: string): void;
}

export type UpdateResult =
  | { status: "updated"; backup: string | null }
  | { status: "rolled-back"; backup: string; failed: string; error: string }
  | { status: "failed"; backup: string | null; error: string };

/** Stop, copy, install, start, check. On failure, reinstall `from`, put the copy back and start that. */
export async function performUpdate(dir: string, from: string, to: string, steps: UpdateSteps, opts: { backup: boolean; now?: Date }): Promise<UpdateResult> {
  dir = assertHousehold(dir);
  steps.log("Stopping OpenBuddies");
  if (!(await steps.stop())) return { status: "failed", backup: null, error: "Couldn't stop the running server. Nothing was changed." };

  let backup: string | null = null;
  if (opts.backup) {
    backup = updateBackupPath(dir, to, opts.now);
    steps.log(`Keeping a copy of your household at ${backup}`);
    cpSync(dir, backup, { recursive: true, preserveTimestamps: true });
    if (!existsSync(join(backup, "openbuddies.yaml"))) {
      steps.start();
      return { status: "failed", backup: null, error: "The copy of your household didn't complete, so nothing was updated." };
    }
  }

  steps.log(`Installing OpenBuddies ${to}`);
  const installed = steps.install(to);
  if (!installed.ok) {
    // npm leaves the old version in place when an install fails; start it again.
    steps.start();
    return { status: "failed", backup, error: `Couldn't install ${to}:\n${installed.output.trim()}` };
  }

  steps.log("Starting the new version");
  const started = steps.start();
  const running = started.ok ? await steps.runningVersion() : null;
  if (started.ok && running === to) return { status: "updated", backup };

  const error = started.ok ? `The server came up as ${running ?? "nothing"}, not ${to}.` : started.output.trim();
  if (!backup) return { status: "failed", backup: null, error: `${to} didn't start, and there's no copy to go back to:\n${error}` };

  // Put everything back: the previous version, and the household as it was before the new version touched it.
  steps.log(`${to} didn't start. Going back to ${from}`);
  await steps.stop();
  steps.install(from);
  const failed = `${dir}-failed-${to}`;
  rmSync(failed, { recursive: true, force: true });
  renameSync(dir, failed);
  cpSync(backup, dir, { recursive: true, preserveTimestamps: true });
  steps.start();
  return { status: "rolled-back", backup, failed, error };
}

async function latestVersion(): Promise<string> {
  const res = await fetch("https://registry.npmjs.org/openbuddies/latest", { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`npm answered ${res.status}`);
  return String(((await res.json()) as { version: string }).version);
}

export async function runUpdate(home: string, opts: { yes?: boolean; to?: string; backup?: boolean }) {
  const root = packageRoot();
  const from = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version as string;
  let dir: string;
  try {
    dir = assertHousehold(home);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  let port = DEFAULT_PORT;
  try {
    port = loadHousehold(dir).config.port;
  } catch {}

  const how = installKind(root);
  if (how.kind === "source") {
    console.log(`This is a copy of the OpenBuddies code (${root}). Update it with git pull, pnpm install and pnpm build, then openbuddies start.`);
    process.exit(1);
  }
  if (how.kind === "other") {
    console.log(`OpenBuddies is installed somewhere update doesn't know how to change (${root}). Reinstall it with the installer or npm install -g openbuddies.`);
    process.exit(1);
  }

  let to = opts.to;
  if (!to) {
    try {
      to = await latestVersion();
    } catch (e) {
      console.error(`Couldn't check for a new version: ${(e as Error).message}. Check your internet connection.`);
      process.exit(1);
    }
    if (!isNewer(to, from)) {
      console.log(`You have the latest version (${from}).`);
      const running = await runningServer(port);
      if (running?.code && !running.code.startsWith(`${from}+`)) console.log("The server is still running an older version. Run `openbuddies start` to restart it.");
      return;
    }
  }
  if (to === from) {
    console.log(`OpenBuddies ${from} is already installed.`);
    return;
  }

  const forward = isNewer(to, from);
  console.log(`OpenBuddies ${from} → ${to}.${forward ? ` What's new: ${RELEASES_URL}` : " (an older version)"}`);
  if (!opts.yes) {
    const go = await p.confirm({
      message: `${forward ? "Update" : "Go back"} now? OpenBuddies stops for a minute or so${opts.backup === false ? "" : ", and a copy of your household is kept first"}.`,
      initialValue: true,
    });
    if (p.isCancel(go) || !go) return console.log("Nothing was changed.");
  }

  const nodeBin = dirname(process.execPath);
  const npm = existsSync(join(nodeBin, "npm")) ? join(nodeBin, "npm") : "npm";
  // npm's own script starts with `env node`, so the Node running OpenBuddies goes first on the PATH.
  const env = { ...process.env, PATH: `${nodeBin}:${process.env.PATH ?? ""}` };
  const cli = join(root, "dist", "src", "cli", "index.js");
  const run = (cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, { env, encoding: "utf8" });
    return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? r.error.message : ""}` };
  };
  const result = await performUpdate(
    dir,
    from,
    to,
    {
      install: (v) => run(npm, ["install", "--global", "--prefix", how.prefix, "--no-fund", "--no-audit", "--no-update-notifier", "--loglevel=error", `openbuddies@${v}`]),
      // The installed CLI, run fresh, so the new version starts its own server.
      start: () => run(process.execPath, [cli, "start", "--home", dir, "--no-open", "--no-qr"]),
      stop: () => stopServer(dir, port),
      runningVersion: async () => (await runningServer(port))?.code?.split("+")[0] ?? null,
      log: (msg) => console.log(`· ${msg}`),
    },
    { backup: opts.backup !== false },
  );

  if (result.status === "updated") {
    const pruned = result.backup ? pruneUpdateBackups(dir) : [];
    console.log(`\n${forward ? "Updated to" : "Now on"} OpenBuddies ${to}. It's running again; children just reload the app.`);
    if (result.backup) console.log(`A copy of your household from before the update is at ${result.backup}${pruned.length ? ` (older copies removed: ${pruned.length})` : ""}.`);
    return;
  }
  if (result.status === "rolled-back") {
    console.error(`\n${to} didn't start, so OpenBuddies is back on ${from} with your household as it was.`);
    console.error(`What went wrong:\n${result.error}\n\nThe household as ${to} left it is at ${result.failed}. Server log: ${serverLogPath(dir)}`);
    console.error(`Please report it: https://github.com/boyney123/openbuddies/issues`);
    process.exit(1);
  }
  console.error(`\n${result.error}`);
  if (result.backup) console.error(`A copy of your household from before the update is at ${result.backup}.`);
  process.exit(1);
}
