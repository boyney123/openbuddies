import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertHousehold, backupPathFor, performReset, planReset } from "../src/cli/reset.js";
import { Db } from "../src/server/db.js";
import { makeHousehold } from "./helpers.js";

async function householdWithHistory() {
  const dir = await makeHousehold();
  const db = new Db(join(dir, "data", "openbuddies.db"));
  const { session } = db.currentSession("sam", "homework", 30);
  db.insertTurn({ sessionId: session.id, role: "child", text: "hi" });
  db.insertTurn({ sessionId: session.id, role: "tutor", text: "hello" });
  db.redeemPairingToken(db.createPairingToken("sam"), "iPhone");
  db.close();
  return dir;
}

describe("openbuddies reset", () => {
  it("counts what will be deleted", async () => {
    const dir = await householdWithHistory();
    const plan = planReset(dir, join(tmpdir(), "no-pointer"));
    expect(plan).toMatchObject({ children: ["Sam"], sessions: 1, messages: 2, devices: 1, pointer: null });
  });

  it("keeps a backup, then deletes the household and the pointer to it", async () => {
    const dir = await householdWithHistory();
    const pointer = join(mkdtempSync(join(tmpdir(), "rc-")), ".openbuddiesrc");
    writeFileSync(pointer, dir + "\n");
    const plan = planReset(dir, pointer);
    expect(plan.pointer).toBe(pointer);
    const backup = performReset(plan, { backupTo: backupPathFor(dir) });
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(pointer)).toBe(false);
    expect(readFileSync(join(backup!, "openbuddies.yaml"), "utf8")).toContain("parent:");
    expect(existsSync(join(backup!, "data", "openbuddies.db"))).toBe(true);
  });

  it("leaves a pointer to some other household alone", async () => {
    const dir = await householdWithHistory();
    const pointer = join(mkdtempSync(join(tmpdir(), "rc-")), ".openbuddiesrc");
    writeFileSync(pointer, "/somewhere/else\n");
    performReset(planReset(dir, pointer), { backupTo: null });
    expect(existsSync(pointer)).toBe(true);
  });

  it("deletes nothing if the backup can't be made", async () => {
    const dir = await householdWithHistory();
    const taken = mkdtempSync(join(tmpdir(), "taken-"));
    expect(() => performReset(planReset(dir), { backupTo: taken })).toThrow(/already exists/);
    expect(existsSync(join(dir, "openbuddies.yaml"))).toBe(true);
  });

  it("refuses folders that aren't an OpenBuddies household", () => {
    const plain = mkdtempSync(join(tmpdir(), "not-openbuddies-"));
    mkdirSync(join(plain, "important"));
    expect(() => planReset(plain)).toThrow(/doesn't look like an OpenBuddies household/);
    expect(existsSync(join(plain, "important"))).toBe(true);
    expect(() => assertHousehold(homedir())).toThrow(/Refusing/);
    expect(() => assertHousehold("/")).toThrow(/Refusing/);
  });

  it("names backups next to the household with a timestamp", () => {
    expect(backupPathFor("/home/dad/openbuddies", new Date("2026-10-20T18:05:00Z"))).toBe("/home/dad/openbuddies-backup-2026-10-20T18-05-00");
  });
});
