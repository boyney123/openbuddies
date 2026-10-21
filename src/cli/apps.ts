// `openbuddies apps`: see, add and remove apps, and turn them on or off for each child (src/server/apps.ts). Adding an
// app shows everything it is (its details, what it uses and the buddy's instructions in full) and asks before
// installing; it starts off for every child unless you pick them here.

import { existsSync } from "node:fs";
import * as p from "@clack/prompts";
import { gallery, installApp, previewApp, removeApp } from "../server/apps.js";
import { appOn, type Household } from "../server/config.js";
import { setAppFor } from "../server/subjects.js";

const NEEDS: Record<string, string> = {
  hint_ladder: "hints step by step",
  files: "the child's files",
  web: "looking things up online",
  reminders: "reminders",
  pictures: "making pictures",
};

export function appsList(h: Household) {
  for (const a of h.apps.values()) {
    const kids = [...h.children.values()].map((c) => `${c.profile.name} ${appOn(c, a) ? "on" : "off"}`).join(", ");
    console.log(`${a.id.padEnd(16)} ${a.name} ${a.version} by ${a.author} (${a.source})${kids ? `: ${kids}` : ""}`);
  }
}

export async function appsGallery(h: Household) {
  for (const g of await gallery(h)) console.log(`${g.id.padEnd(16)} ${g.name}: ${g.description} [${g.catalogue}]${g.installed ? " (added)" : ""}`);
  console.log("\nAdd one with: openbuddies apps add <id>");
}

export async function appsAdd(h: Household, source: string, opts: { yes?: boolean; children?: string }) {
  // A plain id means the gallery.
  const from = /^[a-z0-9][a-z0-9-]+$/.test(source) && !existsSync(source) ? `gallery:${source}` : source;
  let preview;
  try {
    preview = await previewApp(from, h);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  console.log(`\n${preview.name} ${preview.version} by ${preview.author}${preview.installed ? " (an update)" : ""}`);
  console.log(`${preview.description}`);
  console.log(`Uses: ${preview.needs.map((n) => NEEDS[n]).join(", ") || "nothing extra"}${preview.kind === "studio" ? " (a picture studio)" : ""}`);
  console.log(`From: ${preview.origin}\n\nWhat it tells the buddy (SKILL.md):\n${"-".repeat(60)}\n${preview.skill.trim()}\n${"-".repeat(60)}`);
  console.log("OpenBuddies' own rules (no answers, welfare alerts, the help level and allowance) always come first.\n");
  let children = opts.children ? opts.children.split(",").map((s) => s.trim()) : [];
  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      console.error("Read the app above, then run again with --yes (and --children sam,mia to turn it on for them).");
      process.exit(1);
    }
    const ok = await p.confirm({ message: `Add ${preview.name}?` });
    if (p.isCancel(ok) || !ok) process.exit(0);
    if (h.children.size) {
      const picked = await p.multiselect({
        message: "Turn it on for (it stays off for anyone you don't pick):",
        options: [...h.children.values()].map((c) => ({ value: c.profile.id, label: c.profile.name })),
        required: false,
      });
      if (p.isCancel(picked)) process.exit(0);
      children = picked as string[];
    }
  }
  try {
    const id = await installApp(from, preview.sha256, h);
    for (const c of children) {
      const child = h.children.get(c);
      if (child) setAppFor(child.dir, id, true);
      else console.error(`No child "${c}"; skipped.`);
    }
    console.log(`Added ${preview.name}.${children.length ? ` On for ${children.join(", ")}.` : " It's off for everyone until you turn it on (openbuddies apps on <child> " + id + ")."}`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

export function appsRemove(h: Household, id: string) {
  try {
    removeApp(id, h);
    console.log(`Removed ${id}.`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

export function appsSwitch(h: Household, childId: string, appId: string, on: boolean) {
  const child = h.children.get(childId);
  const app = h.apps.get(appId);
  if (!child || !app) {
    console.error(!child ? `No child "${childId}".` : `No app "${appId}". See: openbuddies apps`);
    process.exit(1);
  }
  setAppFor(child.dir, app.id, on);
  console.log(`${app.name} is now ${on ? "on" : "off"} for ${child.profile.name}.`);
}
