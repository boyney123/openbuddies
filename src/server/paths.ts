import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The openbuddies package root, whether running from src/ (tsx) or dist/src/ (built). */
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json")) || !existsSync(join(dir, "migrations"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("Could not find the openbuddies package root");
    dir = up;
  }
  return dir;
}

/**
 * Identifies this version of the code: the package version plus when its server code and migrations last changed.
 * A running server reports it, so `openbuddies start` can tell when it's running older code than is now installed.
 */
export function codeVersion(): string {
  const root = packageRoot();
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  let newest = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  // src/ when running from source, dist/src/ when built.
  walk(dirname(dirname(fileURLToPath(import.meta.url))));
  walk(join(root, "migrations"));
  return `${version}+${Math.round(newest)}`;
}

/**
 * A random id for a household folder, made once and kept in data/. A server reports the id of the household it
 * loaded, so a server still running an old setup of the same folder (from before `openbuddies init` or `reset`) is noticed.
 */
export function householdId(home: string): string {
  const file = join(home, "data", "household-id");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const id = randomBytes(12).toString("hex");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, id);
  return id;
}
