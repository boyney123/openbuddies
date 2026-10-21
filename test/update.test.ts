import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installKind, isNewer, performUpdate, pruneUpdateBackups, type UpdateSteps } from "../src/cli/update.js";
import { makeHousehold } from "./helpers.js";

/** Fake install/start/stop steps: `bad` versions install but never come up. Records what happened. */
function fakeSteps(opts: { installed: string; bad?: string[]; installFails?: boolean; onInstall?: (v: string) => void }) {
  const done: string[] = [];
  let installed = opts.installed;
  let running: string | null = installed;
  const steps: UpdateSteps = {
    install: (v) => {
      done.push(`install ${v}`);
      if (opts.installFails) return { ok: false, output: "npm ERR! network" };
      installed = v;
      opts.onInstall?.(v);
      return { ok: true, output: "" };
    },
    start: () => {
      done.push("start");
      running = opts.bad?.includes(installed) ? null : installed;
      return running ? { ok: true, output: "" } : { ok: false, output: "OpenBuddies didn't come up" };
    },
    stop: async () => {
      done.push("stop");
      running = null;
      return true;
    },
    runningVersion: async () => running,
    log: () => {},
  };
  return { steps, done, running: () => running };
}

describe("openbuddies update", () => {
  it("knows how it was installed", () => {
    expect(installKind("/Users/x/.openbuddies/lib/node_modules/openbuddies")).toEqual({ kind: "npm", prefix: "/Users/x/.openbuddies" });
    expect(installKind(join(import.meta.dirname, ".."))).toEqual({ kind: "source" });
    expect(installKind("/opt/somewhere/openbuddies")).toEqual({ kind: "other" });
  });

  it("compares versions", () => {
    expect(isNewer("0.1.10", "0.1.9")).toBe(true);
    expect(isNewer("0.2.0", "0.1.9")).toBe(true);
    expect(isNewer("0.1.1", "0.1.1")).toBe(false);
    expect(isNewer("0.1.0", "0.0.0-stage")).toBe(true);
    expect(isNewer("0.0.0-stage", "0.0.0")).toBe(false);
  });

  it("keeps a copy, installs the new version and starts it", async () => {
    const dir = await makeHousehold();
    const f = fakeSteps({ installed: "0.1.1" });
    const r = await performUpdate(dir, "0.1.1", "0.2.0", f.steps, { backup: true });
    expect(r.status).toBe("updated");
    expect(f.done).toEqual(["stop", "install 0.2.0", "start"]);
    expect(f.running()).toBe("0.2.0");
    expect(existsSync(join((r as { backup: string }).backup, "openbuddies.yaml"))).toBe(true);
  });

  it("goes back to the old version and the household as it was when the new one doesn't start", async () => {
    const dir = await makeHousehold();
    const before = readFileSync(join(dir, "openbuddies.yaml"), "utf8");
    // The new version changes the household (as a migration would) and then fails to come up.
    const f = fakeSteps({ installed: "0.1.1", bad: ["0.2.0"], onInstall: (v) => v === "0.2.0" && writeFileSync(join(dir, "openbuddies.yaml"), "broken: true\n") });
    const r = await performUpdate(dir, "0.1.1", "0.2.0", f.steps, { backup: true });
    expect(r.status).toBe("rolled-back");
    expect(f.done).toEqual(["stop", "install 0.2.0", "start", "stop", "install 0.1.1", "start"]);
    expect(f.running()).toBe("0.1.1");
    expect(readFileSync(join(dir, "openbuddies.yaml"), "utf8")).toBe(before);
    expect(readFileSync(join((r as { failed: string }).failed, "openbuddies.yaml"), "utf8")).toBe("broken: true\n");
  });

  it("starts the old version again when the install fails", async () => {
    const dir = await makeHousehold();
    const f = fakeSteps({ installed: "0.1.1", installFails: true });
    const r = await performUpdate(dir, "0.1.1", "0.2.0", f.steps, { backup: true });
    expect(r).toMatchObject({ status: "failed", error: expect.stringContaining("npm ERR! network") });
    expect(f.running()).toBe("0.1.1");
  });

  it("keeps only the newest copies from before updates, and never reset's backups", () => {
    const parent = mkdtempSync(join(tmpdir(), "openbuddies-backups-"));
    const dir = join(parent, "openbuddies");
    mkdirSync(dir);
    const names = ["0.1.0-2026-10-01T10-00-00", "0.1.1-2026-10-02T10-00-00", "0.1.2-2026-10-03T10-00-00", "0.1.3-2026-10-04T10-00-00"];
    for (const n of names) mkdirSync(join(parent, `openbuddies-before-${n}`));
    mkdirSync(join(parent, "openbuddies-backup-2026-09-01T10-00-00"));
    expect(pruneUpdateBackups(dir, 3)).toEqual([join(parent, "openbuddies-before-0.1.0-2026-10-01T10-00-00")]);
    expect(readdirSync(parent).sort()).toEqual(["openbuddies", "openbuddies-backup-2026-09-01T10-00-00", ...names.slice(1).map((n) => `openbuddies-before-${n}`)].sort());
  });
});
