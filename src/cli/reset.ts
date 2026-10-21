// `openbuddies reset`: put OpenBuddies back to a fresh install. The plan/perform functions hold the file logic and never
// touch services, so they can be tested; runReset adds the prompts, stops the server and removes the service.

import * as p from "@clack/prompts";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadHousehold } from "../server/config.js";
import { Db } from "../server/db.js";

export interface ResetPlan {
  dir: string;
  children: string[];
  sessions: number;
  messages: number;
  devices: number;
  /** ~/.openbuddiesrc, if it points at this household. */
  pointer: string | null;
}

/** Refuse anything that isn't clearly an OpenBuddies household, so a mistyped --home can never delete the wrong folder. */
export function assertHousehold(dir: string): string {
  const abs = resolve(dir);
  if (abs === "/" || abs === resolve(homedir())) throw new Error(`Refusing to reset ${abs}: that's not an OpenBuddies folder.`);
  if (!existsSync(join(abs, "openbuddies.yaml"))) throw new Error(`${abs} doesn't look like an OpenBuddies household (no openbuddies.yaml). Nothing was changed.`);
  return abs;
}

export function planReset(dir: string, pointerPath = join(homedir(), ".openbuddiesrc")): ResetPlan {
  const abs = assertHousehold(dir);
  let children: string[] = [];
  try {
    children = [...loadHousehold(abs).children.values()].map((c) => c.profile.name);
  } catch {}
  let sessions = 0;
  let messages = 0;
  let devices = 0;
  const dbPath = join(abs, "data", "openbuddies.db");
  if (existsSync(dbPath)) {
    const db = new Db(dbPath);
    const count = (sql: string) => db.sql.prepare(sql).pluck().get() as number;
    sessions = count("SELECT COUNT(*) FROM sessions");
    messages = count("SELECT COUNT(*) FROM turns");
    devices = count("SELECT COUNT(*) FROM devices WHERE revoked_at IS NULL");
    db.close();
  }
  const pointer = existsSync(pointerPath) && resolve(readFileSync(pointerPath, "utf8").trim()) === abs ? pointerPath : null;
  return { dir: abs, children, sessions, messages, devices, pointer };
}

/** A sibling folder name for the backup, e.g. ~/openbuddies-backup-2026-10-20T18-05-00. */
export function backupPathFor(dir: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, "-");
  return join(dirname(dir), `${dir.split("/").pop()}-backup-${stamp}`);
}

/** Copy the household (optional), then delete it and the pointer. Returns the backup path if one was made. */
export function performReset(plan: ResetPlan, opts: { backupTo?: string | null }): string | null {
  assertHousehold(plan.dir);
  let backup: string | null = null;
  if (opts.backupTo) {
    if (existsSync(opts.backupTo)) throw new Error(`${opts.backupTo} already exists. Nothing was changed.`);
    cpSync(plan.dir, opts.backupTo, { recursive: true, preserveTimestamps: true });
    // Don't delete anything unless the copy is really there.
    if (!existsSync(join(opts.backupTo, "openbuddies.yaml"))) throw new Error("The backup didn't complete. Nothing was deleted.");
    backup = opts.backupTo;
  }
  rmSync(plan.dir, { recursive: true, force: true });
  if (plan.pointer) rmSync(plan.pointer, { force: true });
  return backup;
}

function folderSize(dir: string): string {
  let bytes = 0;
  const walk = (d: string) => {
    for (const entry of readdirSafe(d)) {
      const full = join(d, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else bytes += st.size;
    }
  };
  walk(dir);
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function readdirSafe(d: string): string[] {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
}

export async function runReset(home: string, opts: { yes?: boolean; backup?: boolean }) {
  const { serviceInstalled, stopBackground, uninstallService } = await import("./service.js");
  const { tailscaleStatus } = await import("../server/network.js");
  let plan: ResetPlan;
  try {
    plan = planReset(home);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const port = (() => {
    try {
      return loadHousehold(plan.dir).config.port;
    } catch {
      return 4747;
    }
  })();
  const serving = (await tailscaleStatus(port)).serving;
  // Only this household's service: another household's service is left alone.
  const service = serviceInstalled(plan.dir);

  const lines = [
    `Folder:    ${plan.dir} (${folderSize(plan.dir)})`,
    `Children:  ${plan.children.join(", ") || "none"} — their settings, subjects and buddies`,
    `History:   ${plan.sessions} session${plan.sessions === 1 ? "" : "s"}, ${plan.messages} message${plan.messages === 1 ? "" : "s"}, all alerts`,
    `Devices:   ${plan.devices} paired device${plan.devices === 1 ? "" : "s"} will be logged out`,
    "Settings:  your PIN, API key and models",
    service ? "Service:   the background service that starts OpenBuddies at login" : null,
    serving ? "Tailscale: OpenBuddies' Serve address (Tailscale itself stays installed)" : null,
  ].filter(Boolean) as string[];

  if (opts.yes) {
    console.log(`Resetting OpenBuddies. This removes:\n  ${lines.join("\n  ")}`);
  } else {
    if (!process.stdin.isTTY) {
      console.error("Reset deletes everything. Run it in a terminal to confirm, or pass --yes.");
      process.exit(1);
    }
    p.intro("Reset OpenBuddies");
    p.note(lines.join("\n"), "This will permanently delete");
    const go = await p.confirm({ message: "Reset OpenBuddies back to a fresh install?", initialValue: false });
    if (p.isCancel(go) || !go) {
      p.cancel("Nothing was changed.");
      return;
    }
  }

  let backupTo: string | null = null;
  if (opts.backup !== false) {
    if (opts.yes) backupTo = backupPathFor(plan.dir);
    else {
      const keep = await p.confirm({ message: `Keep a backup copy first? (${backupPathFor(plan.dir)})`, initialValue: true });
      if (p.isCancel(keep)) {
        p.cancel("Nothing was changed.");
        return;
      }
      if (keep) backupTo = backupPathFor(plan.dir);
    }
  }

  if (!opts.yes) {
    const typed = await p.text({
      message: backupTo ? 'Type "reset" to confirm' : 'No backup will be kept. Type "reset" to delete everything',
      validate: (v) => (v?.trim().toLowerCase() === "reset" ? undefined : 'Type the word "reset", or press Ctrl+C to cancel'),
    });
    if (p.isCancel(typed)) {
      p.cancel("Nothing was changed.");
      return;
    }
  }

  const spin = opts.yes ? null : p.spinner();
  spin?.start("Stopping OpenBuddies");
  stopBackground(plan.dir);
  if (service) uninstallService();
  if (serving) {
    const { tailscaleOff } = await import("./tailscale.js");
    await tailscaleOff(port).catch(() => false);
  }
  spin?.message(backupTo ? "Backing up and removing the household" : "Removing the household");
  let backup: string | null;
  try {
    backup = performReset(plan, { backupTo });
  } catch (e) {
    spin?.stop("Stopped");
    console.error((e as Error).message);
    process.exit(1);
  }
  spin?.stop("OpenBuddies has been reset");

  const done = [backup ? `Backup kept at ${backup}` : "No backup was kept.", "Run `openbuddies init` to set OpenBuddies up again."];
  if (backup) done.push(`Changed your mind? Move the backup back with: mv "${backup}" "${plan.dir}" and run \`openbuddies start\`.`);
  if (opts.yes) console.log(done.join("\n"));
  else p.outro(done.join("\n"));
}
