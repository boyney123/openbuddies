// Create a child's folder. Used by `openbuddies init`, `openbuddies children add` and the parent page.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { normaliseSubject, type Mode, type Subject } from "./config.js";

export interface ChildSpec {
  name: string;
  age: number;
  year: string;
  /** How much help to give: strict (never give answers), balanced (answer after real effort) or relaxed. */
  mode: Mode;
  /** Optional subjects to start with, and their own modes. Children can also add subjects for their buddies. */
  subjects?: Subject[];
  modes?: Record<Subject, Mode>;
}

const RULES_HEADER = `# Rules for this child. OpenBuddies reloads this file when you save it.
# default_mode: how much help to give: strict (never give answers), balanced (answer after real effort), relaxed.
# subjects: a subject listed here with its own mode overrides default_mode for that subject.
# hint_ladder: the rungs the tutor climbs when the child is stuck. worked_example is the top.
# alerts.welfare.sensitivity: high alerts when upset or worrying; medium/low only when worrying.
# hours (optional): when the tutor is available, e.g.  hours: { weekdays: "07:00-21:00", weekends: "08:00-20:00" }
# daily_tokens (optional): this child's daily AI allowance in tokens; without it, budget.daily_tokens_per_child in
#   openbuddies.yaml applies. Change it on the parent page under Children, or: openbuddies children allowance <child> <tokens>
# web (optional): looking things up on the internet. mode: off, trusted (only trusted sites) or open (any site, with
#   SafeSearch strict and a blocklist; the default for now). sites: extra trusted sites, blocked: extra blocked sites,
#   daily_lookups: lookups a day (30). Needs a search provider: openbuddies web setup.
`;

export function slug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "child";
}

/** A folder id for this name that isn't taken yet: "sam", then "sam-2", ... */
export function freeChildId(householdDir: string, name: string, taken: string[] = []): string {
  const dir = join(householdDir, "children");
  const existing = new Set([...(existsSync(dir) ? readdirSync(dir) : []), ...taken]);
  const base = slug(name);
  let id = base;
  for (let n = 2; existing.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Check a child's details. Returns an error message, or null when they're fine. */
export function validateChild(spec: Partial<ChildSpec>): string | null {
  if (!spec.name?.trim() || spec.name.trim().length > 40) return "Enter the child's first name (up to 40 characters).";
  if (!Number.isInteger(spec.age) || spec.age! < 4 || spec.age! > 19) return "Age should be a whole number between 4 and 19.";
  if ((spec.year ?? "").length > 40) return "School year is too long.";
  if (!["strict", "balanced", "relaxed"].includes(spec.mode ?? "")) return "Choose how much help to give: strict, balanced or relaxed.";
  for (const s of spec.subjects ?? []) if (!normaliseSubject(s)) return `"${s}" isn't a usable subject name.`;
  for (const m of Object.values(spec.modes ?? {})) if (!["strict", "balanced", "relaxed"].includes(m)) return `Unknown strictness "${m}".`;
  return null;
}

/** Write children/<id>/ (profile.yaml, rules.yaml, sessions/). Returns the id. Never overwrites an existing child. */
export function writeChild(householdDir: string, spec: ChildSpec, id = freeChildId(householdDir, spec.name)): string {
  const error = validateChild(spec);
  if (error) throw new Error(error);
  const cdir = join(householdDir, "children", id);
  if (existsSync(join(cdir, "profile.yaml"))) throw new Error(`A child called "${id}" already exists.`);
  mkdirSync(join(cdir, "sessions"), { recursive: true });
  const subjects = [...new Set((spec.subjects ?? []).map((s) => normaliseSubject(s)).filter(Boolean) as Subject[])];
  writeFileSync(join(cdir, "profile.yaml"), YAML.stringify({ name: spec.name.trim(), age: spec.age, year: spec.year.trim(), subjects }));
  // Only subjects given a mode of their own are listed in rules.yaml; the rest follow default_mode.
  const modes = Object.fromEntries(subjects.filter((s) => spec.modes?.[s]).map((s) => [s, { mode: spec.modes![s] }]));
  writeFileSync(
    join(cdir, "rules.yaml"),
    RULES_HEADER +
      YAML.stringify({
        default_mode: spec.mode,
        subjects: modes,
        hint_ladder: ["ask", "nudge", "worked_example", "check"],
        max_leak_retries: 2,
        alerts: { welfare: { sensitivity: "high" } },
      }),
  );
  return id;
}
