// Adding apps to a household, from the gallery or from anyone: an app is a folder of text (app.yaml says what it is and
// what it needs, SKILL.md tells the buddy how to help), never code. So an app can't run anything on this machine, add
// tools to the tutor or step round the pipeline: the leak check, welfare alerts, help level and allowance apply to every
// app. What a stranger's app can do is write bad instructions, so the parent reads it (app.yaml and SKILL.md in full)
// and approves it before it's installed, and an installed app starts off for every child until the parent turns it on.
//
// Where apps come from:
// - The gallery: the starter apps that come with OpenBuddies (gallery/<id>/), plus any catalogues the parent adds in
//   openbuddies.yaml (apps.catalogues: an index.json listing apps as bundles, each with its SHA-256).
// - A bundle link: one JSON file, { "id": "...", "files": { "app.yaml": "...", "SKILL.md": "..." } }.
// - A folder on this machine.
// Installing records where it came from in the app's install.yaml.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import YAML from "yaml";
import { loadApp, type AppConfig, type Household } from "./config.js";
import { packageRoot } from "./paths.js";

const FILES = new Set(["app.yaml", "SKILL.md", "README.md"]);
const MAX_FILE = 40_000;
const MAX_BUNDLE = 128_000;
const APP_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;

export interface AppPackage {
  id: string;
  files: Record<string, string>;
  /** SHA-256 of the files as installed: what the parent approves is what gets installed. */
  sha256: string;
  origin: string;
}

/** What a parent reviews before installing: the app as OpenBuddies reads it, and its instructions in full. */
export interface AppPreview {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  kind: AppConfig["kind"];
  needs: AppConfig["needs"];
  skill: string;
  origin: string;
  sha256: string;
  /** Already installed (an update), or the id of a built-in app (can't be replaced). */
  installed: boolean;
}

export interface GalleryEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  /** "OpenBuddies" for the starter apps, else the catalogue's name. */
  catalogue: string;
  /** What to pass to preview/install. */
  source: string;
  installed: boolean;
}

const hashFiles = (files: Record<string, string>) =>
  createHash("sha256")
    .update(JSON.stringify(Object.keys(files).sort().map((k) => [k, files[k]])))
    .digest("hex");

/** Check a package's files: only app.yaml, SKILL.md and README.md, as text, not too big. */
function checkFiles(id: string, files: Record<string, unknown>): Record<string, string> {
  if (!APP_ID.test(id)) throw new Error(`"${id}" isn't a usable app id (2 to 40 lowercase letters, numbers and dashes).`);
  const out: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    if (!FILES.has(name)) throw new Error(`An app can only contain app.yaml, SKILL.md and README.md, not "${name}".`);
    if (typeof content !== "string" || content.length > MAX_FILE) throw new Error(`${name} is missing or too big.`);
    out[name] = content;
  }
  if (!out["app.yaml"] || !out["SKILL.md"]) throw new Error("An app needs an app.yaml and a SKILL.md.");
  return out;
}

/** Read a package as the server would load it, to check it's valid and to show the parent. */
function preview(pkg: AppPackage, household: Household): AppPreview {
  const dir = mkdtempSync(join(tmpdir(), "openbuddies-app-"));
  try {
    const appDir = join(dir, pkg.id);
    mkdirSync(appDir);
    for (const [name, content] of Object.entries(pkg.files)) writeFileSync(join(appDir, name), content);
    const app = loadApp(appDir, pkg.id, "installed");
    const existing = household.apps.get(pkg.id);
    return {
      id: pkg.id,
      name: app.name,
      description: app.description,
      author: app.author,
      version: app.version,
      kind: app.kind,
      needs: app.needs,
      skill: app.skill,
      origin: pkg.origin,
      sha256: pkg.sha256,
      installed: !!existing,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function fetchText(url: string, max: number): Promise<string> {
  if (!/^https:\/\//.test(url)) throw new Error("Apps can only be downloaded over https.");
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "follow" });
  if (!res.ok) throw new Error(`Couldn't download it (${res.status}).`);
  const text = await res.text();
  if (text.length > max) throw new Error("That's too big to be an app.");
  return text;
}

function readFolder(dir: string, id: string, origin: string): AppPackage {
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    if (statSync(join(dir, name)).isDirectory()) throw new Error(`An app can't contain folders ("${name}").`);
    files[name] = readFileSync(join(dir, name), "utf8");
  }
  const checked = checkFiles(id, files);
  return { id, files: checked, sha256: hashFiles(checked), origin };
}

const starterDir = () => join(packageRoot(), "gallery");

/** Catalogues the parent added (openbuddies.yaml apps.catalogues). */
async function remoteCatalogues(household: Household): Promise<{ url: string; name: string; apps: any[] }[]> {
  const out = [];
  for (const url of household.config.catalogues) {
    try {
      const index = JSON.parse(await fetchText(url, MAX_BUNDLE));
      out.push({ url, name: String(index?.name ?? new URL(url).host).slice(0, 40), apps: Array.isArray(index?.apps) ? index.apps.slice(0, 200) : [] });
    } catch {
      out.push({ url, name: new URL(url).host, apps: [] });
    }
  }
  return out;
}

/** Everything the parent can add: the starter apps, then the apps in any catalogues they've added. */
export async function gallery(household: Household): Promise<GalleryEntry[]> {
  const entries: GalleryEntry[] = [];
  if (existsSync(starterDir())) {
    for (const id of readdirSync(starterDir()).sort()) {
      try {
        const app = loadApp(join(starterDir(), id), id, "installed");
        entries.push({ id, name: app.name, description: app.description, author: app.author, version: app.version, catalogue: "OpenBuddies", source: `gallery:${id}`, installed: household.apps.has(id) });
      } catch {}
    }
  }
  for (const cat of await remoteCatalogues(household)) {
    for (const a of cat.apps) {
      if (typeof a?.id !== "string" || !APP_ID.test(a.id) || typeof a?.bundle !== "string") continue;
      entries.push({
        id: a.id,
        name: String(a.name ?? a.id).slice(0, 30),
        description: String(a.description ?? "").slice(0, 80),
        author: String(a.author ?? "Unknown").slice(0, 40),
        version: String(a.version ?? "").slice(0, 20),
        catalogue: cat.name,
        source: `catalogue:${cat.url}#${a.id}`,
        installed: household.apps.has(a.id),
      });
    }
  }
  return entries;
}

/**
 * Fetch an app from where the parent said: `gallery:<id>`, `catalogue:<index url>#<id>`, a bundle's https link, or a
 * folder on this machine.
 */
export async function fetchApp(source: string, household: Household): Promise<AppPackage> {
  if (source.startsWith("gallery:")) {
    const id = source.slice("gallery:".length);
    if (!APP_ID.test(id) || !existsSync(join(starterDir(), id))) throw new Error(`There's no "${id}" in the gallery.`);
    return readFolder(join(starterDir(), id), id, source);
  }
  if (source.startsWith("catalogue:")) {
    const [url, id] = source.slice("catalogue:".length).split("#");
    if (!household.config.catalogues.includes(url)) throw new Error("That catalogue isn't one you've added.");
    const entry = (JSON.parse(await fetchText(url, MAX_BUNDLE))?.apps ?? []).find((a: any) => a?.id === id);
    if (!entry || typeof entry.bundle !== "string") throw new Error(`The catalogue doesn't list "${id}".`);
    const raw = await fetchText(new URL(entry.bundle, url).href, MAX_BUNDLE);
    const sha = createHash("sha256").update(raw).digest("hex");
    if (typeof entry.sha256 === "string" && entry.sha256.toLowerCase() !== sha) throw new Error("The download doesn't match the catalogue's fingerprint, so it wasn't used.");
    return fromBundle(raw, source);
  }
  if (/^https:\/\//.test(source)) return fromBundle(await fetchText(source, MAX_BUNDLE), source);
  if (existsSync(source) && statSync(source).isDirectory()) return readFolder(source, basename(source), source);
  throw new Error("Give a gallery app, an https link to an app bundle, or a folder.");
}

function fromBundle(raw: string, origin: string): AppPackage {
  let bundle: any;
  try {
    bundle = JSON.parse(raw);
  } catch {
    throw new Error("That isn't an app bundle (it should be JSON with id and files).");
  }
  const files = checkFiles(String(bundle?.id ?? ""), bundle?.files ?? {});
  return { id: bundle.id, files, sha256: hashFiles(files), origin };
}

export async function previewApp(source: string, household: Household): Promise<AppPreview> {
  const pkg = await fetchApp(source, household);
  const p = preview(pkg, household);
  if (household.apps.get(pkg.id)?.source === "builtin") throw new Error(`"${pkg.id}" is the name of a built-in app, so it can't be replaced.`);
  return p;
}

/**
 * Install an app the parent reviewed. `sha256` is the fingerprint they saw: if what's fetched now differs, nothing is
 * installed. Returns the app's id.
 */
export async function installApp(source: string, sha256: string, household: Household): Promise<string> {
  const pkg = await fetchApp(source, household);
  if (pkg.sha256 !== sha256) throw new Error("The app changed since you looked at it. Look at it again before adding it.");
  preview(pkg, household);
  if (household.apps.get(pkg.id)?.source === "builtin") throw new Error(`"${pkg.id}" is the name of a built-in app, so it can't be replaced.`);
  const dir = join(household.dir, "apps", pkg.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(pkg.files)) writeFileSync(join(dir, name), content);
  writeFileSync(
    join(dir, "install.yaml"),
    `# Added with OpenBuddies. Delete this folder (or use the parent page) to remove the app.\n${YAML.stringify({ source: pkg.origin, sha256: pkg.sha256, installed_at: new Date().toISOString() })}`,
  );
  return pkg.id;
}

/** Remove an installed (or parent-made) app. Built-in apps can only be turned off. */
export function removeApp(id: string, household: Household) {
  const app = household.apps.get(id);
  if (!app) throw new Error(`There's no app "${id}".`);
  if (app.source === "builtin") throw new Error(`${app.name} comes with OpenBuddies: turn it off for a child instead.`);
  rmSync(join(household.dir, "apps", id), { recursive: true, force: true });
}
