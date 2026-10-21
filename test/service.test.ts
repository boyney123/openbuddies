import { describe, expect, it } from "vitest";
import { staleReason } from "../src/cli/service.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowanceFor, DEFAULT_RULES, modeFor, parseRules } from "../src/server/config.js";
import { setAllowance } from "../src/server/subjects.js";

describe("spotting a stale server", () => {
  const current = { householdId: "abc", code: "0.1.0+2" };
  const home = "/home/sam/openbuddies";

  it("reuses a server running this setup of this folder with this code", () =>
    expect(staleReason({ home, householdId: "abc", code: "0.1.0+2" }, home, current)).toBeNull());

  it.each([
    [{}, /older version/],
    [{ home: "/elsewhere", householdId: "abc", code: "0.1.0+2" }, /different household/],
    [{ home, householdId: "old", code: "0.1.0+2" }, /previous setup/],
    [{ home, householdId: "abc", code: "0.1.0+1" }, /older version/],
  ])("restarts a server that reports %j", (running, reason) => expect(staleReason(running, home, current)).toMatch(reason));
});

describe("help level", () => {
  it("is strict unless the parent chooses otherwise", () => {
    expect(parseRules({}).default_mode).toBe("strict");
    expect(modeFor(DEFAULT_RULES, "chess")).toBe("strict");
  });

  it("applies to every subject without its own mode, including unknown ones", () => {
    const rules = parseRules({ default_mode: "balanced", subjects: { maths: { mode: "strict" } } });
    expect(modeFor(rules, "maths")).toBe("strict");
    expect(modeFor(rules, "chess")).toBe("balanced");
    expect(modeFor(rules, null)).toBe("balanced");
  });

  it("refuses a level it doesn't know", () => expect(() => parseRules({ default_mode: "lenient" })).toThrow(/default_mode/));
});

describe("daily allowance", () => {
  const household = { config: { budget: { daily_tokens_per_child: 400_000 } } } as any;

  it("is the household's unless the child has their own", () => {
    expect(allowanceFor(household, { rules: parseRules({}) })).toBe(400_000);
    expect(allowanceFor(household, { rules: parseRules({ daily_tokens: 150_000 }) })).toBe(150_000);
  });

  it.each([0, 500, 12.5, "lots"])("refuses %j", (v) => expect(() => parseRules({ daily_tokens: v })).toThrow(/daily_tokens/));

  it("is saved in rules.yaml, keeping the parent's comments, and can go back to the default", () => {
    const dir = mkdtempSync(join(tmpdir(), "openbuddies-allowance-"));
    writeFileSync(join(dir, "rules.yaml"), "# my notes\ndefault_mode: strict\n");
    setAllowance(dir, 250_000);
    expect(readFileSync(join(dir, "rules.yaml"), "utf8")).toMatch(/# my notes[\s\S]*daily_tokens: 250000/);
    setAllowance(dir, null);
    expect(readFileSync(join(dir, "rules.yaml"), "utf8")).not.toContain("daily_tokens");
    expect(() => setAllowance(dir, 50)).toThrow(/at least/);
  });
});
