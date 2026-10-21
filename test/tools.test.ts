import { describe, expect, it } from "vitest";
import { decide, type Action } from "../src/server/decide.js";
import { applyToGuardProblem, effectVisibleText, guardToolCall, sameProblem, type GuardContext } from "../src/server/tools.js";
import { intent, rules } from "./helpers.js";

const action = (patch: Partial<Action>): Action => ({ ...decide(intent(), { problem: null, isNewProblem: false }, rules(), { hint_ladder: true }), ...patch });
const problem = { label: "Q3", text: "Work out 2/3 + 1/4", correct: false };
const ctx = (a: Partial<Action>, p: GuardContext["problem"] = problem): GuardContext => ({ action: action(a), problem: p });

describe("give_hint guard", () => {
  it("rejects a rung above the allowed one", () => {
    const r = guardToolCall("give_hint", { rung: "worked_example", text: "Try this" }, ctx({ kind: "nudge", rung: "nudge" }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/nudge/);
  });
  it("accepts the allowed rung and lower ones", () => {
    expect(guardToolCall("give_hint", { rung: "nudge", text: "What's a common denominator?" }, ctx({ kind: "nudge", rung: "nudge" })).ok).toBe(true);
    expect(guardToolCall("give_hint", { rung: "ask", text: "What have you tried?" }, ctx({ kind: "nudge", rung: "nudge" })).ok).toBe(true);
  });
  it("treats no-problem turns as the ask rung", () => {
    expect(guardToolCall("give_hint", { rung: "nudge", text: "x" }, ctx({ kind: "ask", rung: null }, null)).ok).toBe(false);
  });
  it("rejects malformed arguments", () => {
    expect(guardToolCall("give_hint", { rung: "shout", text: "x" }, ctx({ kind: "nudge", rung: "nudge" })).ok).toBe(false);
    expect(guardToolCall("give_hint", { rung: "nudge" }, ctx({ kind: "nudge", rung: "nudge" })).ok).toBe(false);
  });
});

describe("show_worked_example guard", () => {
  const atExample = { kind: "worked_example" as const, rung: "worked_example" as const };
  it("rejects an example on the active problem itself", () => {
    const r = guardToolCall("show_worked_example", { problem: "2/3 + 1/4", steps: ["Find a common denominator: 12", "8/12 + 3/12 = 11/12"] }, ctx(atExample));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/own problem/);
  });
  it("rejects the same problem reworded", () => {
    expect(guardToolCall("show_worked_example", { problem: "Add 1/4 and 2/3", steps: ["..."] }, ctx(atExample)).ok).toBe(false);
  });
  it("accepts a similar problem with different numbers", () => {
    expect(guardToolCall("show_worked_example", { problem: "1/3 + 1/5", steps: ["Common denominator 15", "5/15 + 3/15 = 8/15"] }, ctx(atExample)).ok).toBe(true);
  });
  it("is locked below the worked_example rung", () => {
    expect(guardToolCall("show_worked_example", { problem: "1/3 + 1/5", steps: ["..."] }, ctx({ kind: "nudge", rung: "nudge" })).ok).toBe(false);
  });
  it("is allowed on the active problem when the answer may be revealed", () => {
    expect(guardToolCall("show_worked_example", { problem: "2/3 + 1/4", steps: ["..."] }, ctx({ kind: "reveal", rung: "nudge", mayRevealAnswer: true })).ok).toBe(true);
  });
});

describe("mark_solved and check_answer guards", () => {
  it("won't mark solved without a confirmed correct answer", () => {
    expect(guardToolCall("mark_solved", { label: "Q3" }, ctx({ kind: "check_answer", rung: "check" })).ok).toBe(false);
  });
  it("marks solved after a correct check earlier in the same turn", () => {
    const checked = guardToolCall("check_answer", { answer: "11/12", correct: true, feedback: "Yes!" }, ctx({ kind: "check_answer", rung: "check" }));
    expect(checked.ok).toBe(true);
    const staged = applyToGuardProblem(problem, (checked as any).effect);
    expect(guardToolCall("mark_solved", { label: "Q3" }, ctx({ kind: "check_answer", rung: "check" }, staged)).ok).toBe(true);
  });
  it("won't mark solved with no active problem", () => {
    expect(guardToolCall("mark_solved", { label: "x" }, ctx({ kind: "check_answer", rung: "check" }, null)).ok).toBe(false);
  });
  it("a new pinned problem is not already correct", () => {
    const staged = applyToGuardProblem({ ...problem, correct: true }, { type: "set_problem", label: "Q4", text: "3/5 - 1/10" });
    expect(staged?.correct).toBe(false);
  });
});

describe("welfare turns", () => {
  it("reject tutoring tools but allow flag_for_parent", () => {
    const w = ctx({ kind: "welfare_response" });
    for (const [tool, args] of [
      ["give_hint", { rung: "ask", text: "x" }],
      ["show_worked_example", { problem: "1+1", steps: ["2"] }],
      ["check_answer", { answer: "1", correct: true, feedback: "y" }],
      ["set_active_problem", { label: "a", text: "b" }],
    ] as const) {
      expect(guardToolCall(tool, args, w).ok).toBe(false);
    }
    const f = guardToolCall("flag_for_parent", { severity: "high", summary: "Sam said something worrying about school." }, w);
    expect(f).toMatchObject({ ok: true, effect: { type: "flag", severity: "high" } });
  });
});

describe("unknown tools", () => {
  it("are rejected", () => expect(guardToolCall("bash", { command: "cat .env" }, ctx({})).ok).toBe(false));
});

describe("sameProblem()", () => {
  it.each([
    ["2/3 + 1/4", "Work out 2/3 + 1/4", true],
    ["2/3 + 1/4", "1/4 + 2/3", true],
    ["2/3 + 1/4", "1/3 + 1/5", false],
    ["Write an opening paragraph about Macbeth's ambition", "write an opening paragraph about macbeth's ambition.", true],
    ["Explain photosynthesis", "Explain how volcanoes form", false],
  ])("%s vs %s → %s", (a, b, same) => expect(sameProblem(a, b)).toBe(same));
});

describe("effectVisibleText()", () => {
  it("includes everything the child would see on cards", () => {
    expect(effectVisibleText({ type: "worked_example", problem: "1/3 + 1/5", steps: ["a", "b"] })).toContain("1. a");
    expect(effectVisibleText({ type: "set_problem", label: "Q3 = 11/12", text: "2/3 + 1/4" })).toContain("11/12");
    expect(effectVisibleText({ type: "flag", severity: "high", summary: "secret" })).toBe("");
  });
});
