import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coerceIntent } from "../src/server/classifier.js";
import { loadHousehold, normaliseSubject, renderContext, subjectLabel } from "../src/server/config.js";
import { decide, INTENTS } from "../src/server/decide.js";
import { classifierSchema } from "../src/server/prompts.js";
import { listSubjects, removeSubject, setSubject } from "../src/server/subjects.js";
import { intent, makeHousehold } from "./helpers.js";

const sam = async () => join(await makeHousehold(), "children", "sam");

describe("subject names", () => {
  it.each([
    ["Maths", "maths"],
    ["Design & Technology", "design-technology"],
    ["  French ", "french"],
    ["Religious Education", "religious-education"],
    ["other", null],
    ["x", null],
    ["!!!", null],
    ["3d art", null],
  ])("%s -> %s", (raw, name) => expect(normaliseSubject(raw)).toBe(name));
  it("labels read naturally", () => expect(subjectLabel("design-technology")).toBe("Design technology"));
});

describe("editing subjects", () => {
  it("adds a custom subject to profile.yaml and rules.yaml, keeping the parent's comments", async () => {
    const dir = await sam();
    expect(setSubject(dir, "Design & Technology", "balanced")).toBe("design-technology");
    expect(listSubjects(dir, "sam").find((s) => s.name === "design-technology")).toEqual({ name: "design-technology", label: "Design technology", mode: "balanced" });
    expect(readFileSync(join(dir, "rules.yaml"), "utf8")).toContain("# Rules for this child");
  });

  it("changes a subject's mode without duplicating it", async () => {
    const dir = await sam();
    setSubject(dir, "maths", "relaxed");
    setSubject(dir, "Maths", "balanced");
    expect(listSubjects(dir, "sam").filter((s) => s.name === "maths")).toEqual([{ name: "maths", label: "Maths", mode: "balanced" }]);
  });

  it("removes a subject from both files", async () => {
    const dir = await sam();
    removeSubject(dir, "English");
    expect(listSubjects(dir, "sam").map((s) => s.name)).toEqual(["maths", "science"]);
    expect(readFileSync(join(dir, "rules.yaml"), "utf8")).not.toContain("english");
  });

  it("rejects bad names, bad modes and unknown subjects", async () => {
    const dir = await sam();
    expect(() => setSubject(dir, "other", "strict")).toThrow(/usable subject name/);
    expect(() => setSubject(dir, "music", "lenient" as any)).toThrow(/Unknown mode/);
    expect(() => removeSubject(dir, "latin")).toThrow(/doesn't have/);
  });

  it("flows into CONTEXT.md", async () => {
    const dir = await sam();
    setSubject(dir, "French", "strict");
    const h = loadHousehold(join(dir, "..", ".."));
    expect(renderContext(h.children.get("sam")!, "Dad")).toContain("- French: Strict");
  });
});

describe("custom subjects in the decision layer", () => {
  it("the classifier schema offers the child's subjects plus other", () => {
    expect((classifierSchema(["maths", "french"]).properties.subject as any).enum).toEqual(["maths", "french", "other"]);
  });
  it("the classifier schema offers every intent decide() knows, so new ones can't be left out", () => {
    expect((classifierSchema([]).properties.intent as any).enum).toEqual([...INTENTS]);
  });
  it("asks for referenced files only when there are files to pick from, and keeps only ones it offered", () => {
    expect(classifierSchema([]).required).not.toContain("files");
    expect(classifierSchema([], true).required).toContain("files");
    const state = { activeProblem: null, activeSubject: null, recent: [], subjects: [], files: [{ id: 7, name: "h.jpg", summary: null, createdAt: "2026-10-20T09:00:00Z" }] };
    expect(coerceIntent({ files: [7, 99, 7, "7"] }, "x", state).files).toEqual([7]);
  });
  it("coerces labels to the child's subjects, falling back safely", () => {
    const state = { activeProblem: null, activeSubject: null, recent: [], subjects: ["french"] };
    expect(coerceIntent({ subject: "french" }, "x", state).subject).toBe("french");
    expect(coerceIntent({ subject: "maths" }, "x", state).subject).toBe("other");
  });
  it("a custom subject's mode is applied, and a removed one is strict", async () => {
    const dir = await sam();
    setSubject(dir, "French", "relaxed");
    let rules = loadHousehold(join(dir, "..", "..")).children.get("sam")!.rules;
    const ask = intent({ subject: "french", intent: "wants_answer" });
    expect(decide(ask, { problem: null, isNewProblem: false }, rules, { hint_ladder: true }).mode).toBe("relaxed");
    removeSubject(dir, "French");
    rules = loadHousehold(join(dir, "..", "..")).children.get("sam")!.rules;
    expect(decide(ask, { problem: null, isNewProblem: false }, rules, { hint_ladder: true })).toMatchObject({ mode: "strict", enforce: true });
  });
});

describe("client address behind Tailscale Serve", async () => {
  const { clientIp } = await import("../src/server/index.js");
  const { allowedParent } = await import("../src/server/auth.js");
  it("uses X-Forwarded-For only when the TCP peer is loopback", () => {
    expect(clientIp("127.0.0.1", "100.101.102.103")).toBe("100.101.102.103");
    expect(clientIp("::ffff:127.0.0.1", "100.64.0.9, 127.0.0.1")).toBe("100.64.0.9");
  });
  it("ignores a forged header from a LAN device", () => {
    expect(clientIp("192.168.0.50", "127.0.0.1")).toBe("192.168.0.50");
    expect(allowedParent(clientIp("192.168.0.50", "127.0.0.1"))).toBe(false);
  });
});
