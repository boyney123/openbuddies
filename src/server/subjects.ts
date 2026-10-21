// Add, change and remove a child's subjects. Used by the CLI and the parent page.
// A subject lives in two files: its name in profile.yaml and its strictness in rules.yaml. Both are edited as YAML
// documents so the comments a parent wrote survive. The server's file watcher picks the change up.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { cleanSite, isAllowance, loadChild, MIN_ALLOWANCE, modeFor, normaliseSubject, subjectLabel, type Mode, type Subject } from "./config.js";

export const MODES: Mode[] = ["strict", "balanced", "relaxed"];

export interface SubjectView {
  name: Subject;
  label: string;
  mode: Mode;
}

export function listSubjects(childDir: string, childId: string): SubjectView[] {
  const child = loadChild(childDir, childId);
  return child.profile.subjects.map((name) => ({ name, label: subjectLabel(name), mode: modeFor(child.rules, name) }));
}

function editYaml(path: string, edit: (doc: YAML.Document) => void) {
  const doc = existsSync(path) ? YAML.parseDocument(readFileSync(path, "utf8")) : new YAML.Document({});
  if (doc.errors.length) throw new Error(`${path}: ${doc.errors[0].message}`);
  edit(doc);
  writeFileSync(path, doc.toString());
}

/** Add a subject, or change its strictness if the child already has it. Returns the stored name. */
export function setSubject(childDir: string, rawName: string, mode: Mode): Subject {
  const name = normaliseSubject(rawName);
  if (!name) throw new Error(`"${rawName}" isn't a usable subject name. Use 2 to 30 letters, numbers or spaces (and not "other").`);
  if (!MODES.includes(mode)) throw new Error(`Unknown mode "${mode}". Use strict, balanced or relaxed.`);
  editYaml(join(childDir, "profile.yaml"), (doc) => {
    const list = ((doc.get("subjects") as YAML.YAMLSeq | undefined)?.toJSON() as string[] | undefined) ?? [];
    if (!list.includes(name)) doc.set("subjects", [...list, name]);
  });
  editYaml(join(childDir, "rules.yaml"), (doc) => {
    doc.setIn(["subjects", name], doc.createNode({ mode }, { flow: true }));
  });
  return name;
}

/** Add a subject that follows the child's default help level (it gets no mode of its own). Returns the stored name. */
export function addSubject(childDir: string, rawName: string): Subject {
  const name = normaliseSubject(rawName);
  if (!name) throw new Error(`"${rawName}" isn't a usable subject name. Use 2 to 30 letters, numbers or spaces (and not "other").`);
  editYaml(join(childDir, "profile.yaml"), (doc) => {
    const list = ((doc.get("subjects") as YAML.YAMLSeq | undefined)?.toJSON() as string[] | undefined) ?? [];
    if (!list.includes(name)) doc.set("subjects", [...list, name]);
  });
  return name;
}

/** Set how much help the child gets in any subject without its own mode. */
export function setDefaultMode(childDir: string, mode: Mode) {
  if (!MODES.includes(mode)) throw new Error(`Unknown mode "${mode}". Use strict, balanced or relaxed.`);
  editYaml(join(childDir, "rules.yaml"), (doc) => doc.set("default_mode", mode));
}

/** Set the child's own daily token allowance, or null to use the household's. */
export function setAllowance(childDir: string, tokens: number | null) {
  if (tokens !== null && !isAllowance(tokens)) throw new Error(`The allowance must be a whole number of tokens, at least ${MIN_ALLOWANCE.toLocaleString("en")}.`);
  editYaml(join(childDir, "rules.yaml"), (doc) => {
    if (tokens === null) doc.delete("daily_tokens");
    else doc.set("daily_tokens", tokens);
  });
}

/** The child's internet setting: off, trusted sites only, or the wider web; plus the parent's own trusted and blocked sites. */
export function setWeb(childDir: string, change: { mode?: unknown; sites?: unknown; blocked?: unknown }) {
  if (change.mode !== undefined && change.mode !== "off" && change.mode !== "trusted" && change.mode !== "open") throw new Error('Internet must be "off", "trusted" or "open".');
  const list = (raw: unknown, what: string) => {
    if (!Array.isArray(raw)) throw new Error(`${what} must be a list of sites.`);
    const sites = raw.map(cleanSite);
    const bad = raw.find((_, i) => !sites[i]);
    if (bad !== undefined) throw new Error(`"${String(bad).slice(0, 60)}" isn't a website address, like bbc.co.uk.`);
    return [...new Set(sites as string[])];
  };
  const sites = change.sites === undefined ? undefined : list(change.sites, "Trusted sites");
  const blocked = change.blocked === undefined ? undefined : list(change.blocked, "Blocked sites");
  editYaml(join(childDir, "rules.yaml"), (doc) => {
    if (change.mode !== undefined) doc.setIn(["web", "mode"], change.mode);
    if (sites) doc.setIn(["web", "sites"], doc.createNode(sites, { flow: true }));
    if (blocked) doc.setIn(["web", "blocked"], doc.createNode(blocked, { flow: true }));
  });
}

/** The app catalogues the parent added, in openbuddies.yaml (apps.catalogues). */
export function setCatalogues(householdDir: string, urls: string[]) {
  const bad = urls.find((u) => !/^https:\/\/\S+$/.test(u));
  if (bad) throw new Error(`"${bad.slice(0, 60)}" isn't an https link.`);
  editYaml(join(householdDir, "openbuddies.yaml"), (doc) => doc.setIn(["apps", "catalogues"], doc.createNode([...new Set(urls)])));
}

/** The buddies' daily check-in: on or off, and when. */
export function setHeartbeat(childDir: string, change: { mode?: unknown; at?: unknown }) {
  if (change.mode !== undefined && change.mode !== "on" && change.mode !== "off") throw new Error('Check-ins must be "on" or "off".');
  if (change.at !== undefined && !(typeof change.at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(change.at))) throw new Error("Pick a time like 16:30.");
  editYaml(join(childDir, "rules.yaml"), (doc) => {
    if (change.mode !== undefined) doc.setIn(["heartbeat", "mode"], change.mode);
    if (change.at !== undefined) doc.setIn(["heartbeat", "at"], change.at);
  });
}

/** Turn an app on or off for the child. */
export function setAppFor(childDir: string, appId: string, on: boolean) {
  editYaml(join(childDir, "rules.yaml"), (doc) => doc.setIn(["apps", appId], on ? "on" : "off"));
}

/** Remove a subject. Anything about it the classifier still sees falls back to "other", which uses the default mode. */
export function removeSubject(childDir: string, rawName: string): Subject {
  const name = normaliseSubject(rawName) ?? rawName;
  let found = false;
  editYaml(join(childDir, "profile.yaml"), (doc) => {
    const list = ((doc.get("subjects") as YAML.YAMLSeq | undefined)?.toJSON() as string[] | undefined) ?? [];
    found = list.includes(name);
    doc.set(
      "subjects",
      list.filter((s) => s !== name),
    );
  });
  if (!found) throw new Error(`This child doesn't have the subject "${name}".`);
  editYaml(join(childDir, "rules.yaml"), (doc) => {
    if (doc.hasIn(["subjects", name])) doc.deleteIn(["subjects", name]);
  });
  return name;
}
