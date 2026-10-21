import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gallery, installApp, previewApp, removeApp } from "../src/server/apps.js";
import { appOn, loadHousehold } from "../src/server/config.js";
import { setAppFor } from "../src/server/subjects.js";
import { makeHousehold } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

function folder(id: string, appYaml: string, skill = "# Skill\nHelp kindly.\n", extra: Record<string, string> = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), "openbuddies-appsrc-")), id);
  mkdirSync(dir);
  writeFileSync(join(dir, "app.yaml"), appYaml);
  writeFileSync(join(dir, "SKILL.md"), skill);
  for (const [k, v] of Object.entries(extra)) writeFileSync(join(dir, k), v);
  return dir;
}

describe("apps that come with OpenBuddies", () => {
  it("are Chat (homework), Picture Studio and Quizzes, on for every child", async () => {
    const h = loadHousehold(await makeHousehold());
    expect([...h.apps.values()].map((a) => [a.id, a.source, a.kind])).toEqual([
      ["homework", "builtin", "tutor"],
      ["picture-studio", "builtin", "studio"],
      ["quizzes", "builtin", "quiz"],
    ]);
    expect(appOn(h.children.get("sam")!, h.apps.get("picture-studio")!)).toBe(true);
  });
});

describe("adding an app", () => {
  it("from the gallery: the parent sees it in full, it's installed as reviewed, and starts off for every child", async () => {
    const home = await makeHousehold();
    let h = loadHousehold(home);
    const listed = await gallery(h);
    expect(listed.map((g) => g.id)).toEqual(["spelling-bee", "story-planner", "times-tables"]);
    const p = await previewApp("gallery:spelling-bee", h);
    expect(p).toMatchObject({ id: "spelling-bee", name: "Spelling Bee", author: "OpenBuddies", kind: "tutor", needs: ["files", "reminders"], installed: false });
    expect(p.skill).toContain("Never write the word out yourself");
    await installApp("gallery:spelling-bee", p.sha256, h);
    h = loadHousehold(home);
    const app = h.apps.get("spelling-bee")!;
    expect(app).toMatchObject({ source: "installed", origin: "gallery:spelling-bee" });
    const sam = h.children.get("sam")!;
    expect(appOn(sam, app)).toBe(false);
    setAppFor(sam.dir, "spelling-bee", true);
    expect(appOn(loadHousehold(home).children.get("sam")!, app)).toBe(true);
    removeApp("spelling-bee", loadHousehold(home));
    expect(loadHousehold(home).apps.has("spelling-bee")).toBe(false);
  });

  it("only installs what the parent reviewed", async () => {
    const h = loadHousehold(await makeHousehold());
    await expect(installApp("gallery:times-tables", "0".repeat(64), h)).rejects.toThrow(/changed since you looked/);
  });

  it.each([
    ["code", folder("quiz", "name: Quiz\n", undefined, { "run.js": "process.exit()" }), /only contain app.yaml, SKILL.md and README.md/],
    ["a feature OpenBuddies doesn't have", folder("quiz", "name: Quiz\nneeds: [shell]\n"), /needs "shell"/],
    ["a built-in app's name", folder("homework", "name: Homework 2\n"), /built-in app/],
    ["no instructions", folder("quiz", "name: Quiz\n", ""), /needs an app.yaml and a SKILL.md/],
  ])("refuses an app with %s", async (_what, dir, error) => {
    const h = loadHousehold(await makeHousehold());
    await expect(previewApp(dir, h)).rejects.toThrow(error);
  });

  it("from a catalogue, only if the download matches its fingerprint", async () => {
    const home = await makeHousehold();
    writeFileSync(join(home, "openbuddies.yaml"), `${(await import("node:fs")).readFileSync(join(home, "openbuddies.yaml"), "utf8")}apps:\n  catalogues: [https://apps.example.com/index.json]\n`);
    const h = loadHousehold(home);
    const bundle = JSON.stringify({ id: "quiz", files: { "app.yaml": "name: Quiz\nneeds: [files]\n", "SKILL.md": "# Quiz\n" } });
    const { createHash } = await import("node:crypto");
    let sha = createHash("sha256").update(bundle).digest("hex");
    vi.stubGlobal("fetch", async (url: string) =>
      new Response(url.endsWith("index.json") ? JSON.stringify({ name: "Example apps", apps: [{ id: "quiz", name: "Quiz", bundle: "quiz.json", sha256: sha }] }) : bundle),
    );
    expect((await gallery(h)).find((g) => g.id === "quiz")).toMatchObject({ catalogue: "Example apps", source: "catalogue:https://apps.example.com/index.json#quiz" });
    expect(await previewApp("catalogue:https://apps.example.com/index.json#quiz", h)).toMatchObject({ id: "quiz", needs: ["files"] });
    sha = "f".repeat(64);
    await expect(previewApp("catalogue:https://apps.example.com/index.json#quiz", h)).rejects.toThrow(/fingerprint/);
    await expect(previewApp("catalogue:https://other.example.com/index.json#quiz", h)).rejects.toThrow(/isn't one you've added/);
  });
});
