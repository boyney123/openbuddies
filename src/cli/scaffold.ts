// Writes a household folder. Used by `openbuddies init`, and by tests and evals to build real households.

import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { apiKeyEnvName, DEFAULT_PORT, loadHousehold, writeContextFiles, type Mode, type Subject } from "../server/config.js";
import { Db } from "../server/db.js";
import { householdId } from "../server/paths.js";
import { freeChildId, writeChild, type ChildSpec } from "../server/children.js";

export type { ChildSpec };

export interface HouseholdSpec {
  dir: string;
  parent: { name: string; title: string; pinHash: string };
  /** Model refs, provider/model. */
  models: { tutor: string; check: string };
  /** An API key for each provider the models use. */
  keys: Record<string, string>;
  children: ChildSpec[];
  port?: number;
}

export function writeHousehold(spec: HouseholdSpec): string[] {
  const dir = spec.dir;
  for (const sub of ["children", "apps", "data", "logs"]) mkdirSync(join(dir, sub), { recursive: true });

  writeFileSync(
    join(dir, "openbuddies.yaml"),
    `# OpenBuddies household settings. Copy this whole folder to back up or move OpenBuddies.\n` +
      YAML.stringify({
        parent: { name: spec.parent.name, title: spec.parent.title, pin_hash: spec.parent.pinHash },
        models: spec.models,
        port: spec.port ?? DEFAULT_PORT,
        budget: { daily_tokens_per_child: 400000 },
        session_idle_minutes: 30,
      }),
  );

  const envPath = join(dir, ".env");
  writeFileSync(envPath, Object.entries(spec.keys).map(([provider, key]) => `${apiKeyEnvName(provider)}=${key}\n`).join(""), { mode: 0o600 });
  chmodSync(envPath, 0o600);


  const ids: string[] = [];
  for (const c of spec.children) ids.push(writeChild(dir, c, freeChildId(dir, c.name, ids)));

  // A new id for this setup: a server still running the folder's previous setup no longer matches it.
  rmSync(join(dir, "data", "household-id"), { force: true });
  householdId(dir);

  const household = loadHousehold(dir);
  writeContextFiles(household);
  const db = new Db(join(dir, "data", "openbuddies.db"));
  db.syncChildren([...household.children.values()].map((c) => ({ id: c.profile.id, name: c.profile.name })));
  db.close();
  return ids;
}

