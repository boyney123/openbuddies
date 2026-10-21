import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeHousehold, type ChildSpec } from "../src/cli/scaffold.js";
import { hashPin } from "../src/server/auth.js";
import { DEFAULT_RULES, type ChildRules, type Mode } from "../src/server/config.js";
import type { Intent } from "../src/server/decide.js";

export const TEST_PIN = "4321";
export const FAKE_KEY = "sk-ant-test-0123456789abcdefghijklmnop";

let pinHash: string | null = null;

export async function makeHousehold(opts: { modes?: ChildSpec["modes"]; children?: ChildSpec[] } = {}): Promise<string> {
  pinHash ??= await hashPin(TEST_PIN);
  const dir = mkdtempSync(join(tmpdir(), "openbuddies-test-"));
  writeHousehold({
    dir,
    parent: { name: "David", title: "Dad", pinHash },
    models: { tutor: "anthropic/claude-sonnet-5-5", check: "anthropic/claude-haiku-5-5" },
    keys: { anthropic: FAKE_KEY },
    children: opts.children ?? [{ name: "Sam", age: 12, year: "Year 7", mode: "strict", subjects: ["maths", "english", "science"], modes: opts.modes ?? { maths: "strict", english: "balanced", science: "relaxed" } }],
  });
  return dir;
}

export function rules(modes: Partial<Record<string, Mode>> = { maths: "strict" }, extra: Partial<ChildRules> = {}): ChildRules {
  return { ...DEFAULT_RULES, subjects: Object.fromEntries(Object.entries(modes).map(([s, mode]) => [s, { mode: mode! }])), ...extra };
}

export function intent(partial: Partial<Intent> = {}): Intent {
  return { intent: "stuck", pressure: "none", subject: "maths", welfare: "fine", problem: "2/3 + 1/4", ...partial };
}
