// The six tutor tools: provider-neutral schemas and the server-side guards that check each call
// against the action decide() chose. agent.ts turns these into Pi tool definitions.

import { RUNGS, type Rung } from "../shared/protocol.js";
import { rungIndex, type Action } from "./decide.js";

export const TUTOR_TOOL_NAMES = ["set_active_problem", "give_hint", "show_worked_example", "check_answer", "mark_solved", "flag_for_parent"] as const;
export type TutorToolName = (typeof TUTOR_TOOL_NAMES)[number];

export interface ToolSpec {
  name: TutorToolName;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

const str = (description: string, maxLength = 2000) => ({ type: "string", description, maxLength });

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "set_active_problem",
    description: "Pin the problem the child is working on, exactly as they gave it. Call this as soon as you know the problem.",
    parameters: {
      type: "object",
      properties: { label: str("Short label, e.g. 'Q3: 2/3 + 1/4'", 120), text: str("The full problem as the child gave it") },
      required: ["label", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "give_hint",
    description: "Deliver one hint at the current ladder rung. The server rejects a rung above the one allowed this turn.",
    parameters: {
      type: "object",
      properties: { rung: { type: "string", enum: [...RUNGS] }, text: str("The hint, 1 to 3 short sentences, ending in a question", 600) },
      required: ["rung", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "show_worked_example",
    description: "Solve a DIFFERENT but similar problem step by step, then hand back. Never use the child's own problem.",
    parameters: {
      type: "object",
      properties: {
        problem: str("The similar example problem (different numbers or text from the child's)", 400),
        steps: { type: "array", items: str("One step", 400), minItems: 1, maxItems: 8 },
      },
      required: ["problem", "steps"],
      additionalProperties: false,
    },
  },
  {
    name: "check_answer",
    description: "Record the child's attempted answer and whether it is right. If wrong, point to the step to look at; never give the correct answer.",
    parameters: {
      type: "object",
      properties: { answer: str("The child's answer", 400), correct: { type: "boolean" }, feedback: str("Short feedback for the child", 600) },
      required: ["answer", "correct", "feedback"],
      additionalProperties: false,
    },
  },
  {
    name: "mark_solved",
    description: "Mark the active problem solved after check_answer confirmed a correct answer. Resets the ladder.",
    parameters: { type: "object", properties: { label: str("The problem label", 120) }, required: ["label"], additionalProperties: false },
  },
  {
    name: "flag_for_parent",
    description: "Quietly alert the parent about something worrying. Not visible to the child. Summary must be short and must not quote the child.",
    parameters: {
      type: "object",
      properties: { severity: { type: "string", enum: ["low", "medium", "high"] }, summary: str("One short sentence for the parent", 200) },
      required: ["severity", "summary"],
      additionalProperties: false,
    },
  },
];

export type ToolEffect =
  | { type: "set_problem"; label: string; text: string }
  | { type: "hint"; rung: Rung; text: string }
  | { type: "worked_example"; problem: string; steps: string[] }
  | { type: "check"; answer: string; correct: boolean; feedback: string }
  | { type: "solved"; label: string }
  | { type: "flag"; severity: "low" | "medium" | "high"; summary: string };

export interface GuardContext {
  action: Action;
  /** The active problem with this turn's accepted (staged) effects applied. */
  problem: { label: string; text: string; correct: boolean } | null;
}

export type GuardResult = { ok: true; effect: ToolEffect } | { ok: false; error: string };

const isStr = (v: unknown, max = 4000): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9/.+\-*=×÷^]+/g, " ").trim();
}

function tokens(s: string): Set<string> {
  return new Set(normalise(s).split(/\s+/).filter((t) => t.length > 1 || /\d/.test(t)));
}

function numbers(s: string): string[] {
  return (s.match(/\d+(?:\.\d+)?/g) ?? []).sort();
}

/**
 * True when two problem statements look like the same problem: the same numbers in the
 * same amounts (for maths), or mostly the same words.
 */
export function sameProblem(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (normalise(a) === normalise(b)) return true;
  const na = numbers(a);
  const nb = numbers(b);
  if (na.length >= 2 && na.join(",") === nb.join(",")) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared) >= 0.75;
}

/** Validate one tool call against this turn's action. Rejections go back to the model as errors and are logged. */
export function guardToolCall(tool: string, args: any, ctx: GuardContext): GuardResult {
  const { action, problem } = ctx;
  if (action.kind === "welfare_response" && tool !== "flag_for_parent") {
    return { ok: false, error: "Tutoring is paused this turn. Respond warmly to how the child is feeling; do not use tutoring tools." };
  }
  const allowed: Rung = action.rung ?? "ask";
  switch (tool) {
    case "set_active_problem":
      if (!isStr(args?.label, 120) || !isStr(args?.text)) return { ok: false, error: "label and text are required." };
      return { ok: true, effect: { type: "set_problem", label: args.label.trim(), text: args.text.trim() } };

    case "give_hint":
      if (!RUNGS.includes(args?.rung) || !isStr(args?.text, 600)) return { ok: false, error: "rung and text are required." };
      if (!action.mayRevealAnswer && rungIndex(args.rung) > rungIndex(allowed)) {
        return { ok: false, error: `This turn is on the "${allowed}" rung. A "${args.rung}" hint is not allowed yet. Give a hint at the "${allowed}" rung.` };
      }
      return { ok: true, effect: { type: "hint", rung: args.rung, text: args.text.trim() } };

    case "show_worked_example": {
      const steps = Array.isArray(args?.steps) ? args.steps.filter((s: unknown) => isStr(s, 400)) : [];
      if (!isStr(args?.problem, 400) || !steps.length) return { ok: false, error: "problem and at least one step are required." };
      if (!action.mayRevealAnswer && rungIndex(allowed) < rungIndex("worked_example")) {
        return { ok: false, error: `Worked examples unlock at the worked_example rung. This turn is on "${allowed}".` };
      }
      if (!action.mayRevealAnswer && problem && sameProblem(args.problem, problem.text)) {
        return { ok: false, error: "That is the child's own problem. A worked example must use a different but similar problem (change the numbers or the text)." };
      }
      return { ok: true, effect: { type: "worked_example", problem: args.problem.trim(), steps: steps.map((s: string) => s.trim()) } };
    }

    case "check_answer":
      if (!isStr(args?.answer, 400) || typeof args?.correct !== "boolean" || !isStr(args?.feedback, 600)) {
        return { ok: false, error: "answer, correct and feedback are required." };
      }
      return { ok: true, effect: { type: "check", answer: args.answer.trim(), correct: args.correct, feedback: args.feedback.trim() } };

    case "mark_solved":
      if (!problem) return { ok: false, error: "There is no active problem to mark solved." };
      if (!problem.correct && !action.mayRevealAnswer) {
        return { ok: false, error: "Only mark a problem solved after check_answer has confirmed the child's correct answer." };
      }
      return { ok: true, effect: { type: "solved", label: isStr(args?.label, 120) ? args.label.trim() : problem.label } };

    case "flag_for_parent": {
      const severity = ["low", "medium", "high"].includes(args?.severity) ? args.severity : "medium";
      if (!isStr(args?.summary, 2000)) return { ok: false, error: "summary is required." };
      return { ok: true, effect: { type: "flag", severity, summary: args.summary.trim().slice(0, 200) } };
    }

    default:
      return { ok: false, error: `Unknown tool ${tool}.` };
  }
}

/** Apply an accepted effect to the staged problem, so later calls in the same turn see it. */
export function applyToGuardProblem(problem: GuardContext["problem"], effect: ToolEffect): GuardContext["problem"] {
  if (effect.type === "set_problem") {
    return { label: effect.label, text: effect.text, correct: problem && sameProblem(problem.text, effect.text) ? problem.correct : false };
  }
  if (effect.type === "check" && problem) return { ...problem, correct: problem.correct || effect.correct };
  return problem;
}

/** Child-visible text a tool effect produces. The leak check reads this along with the reply. */
export function effectVisibleText(e: ToolEffect): string {
  switch (e.type) {
    case "hint":
      return e.text;
    case "worked_example":
      return `Example: ${e.problem}\n${e.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
    case "check":
      return `${e.correct ? "Correct" : "Not quite"}: ${e.feedback}`;
    case "set_problem":
      return `Problem card: ${e.label}\n${e.text}`;
    case "solved":
      return `Solved: ${e.label}`;
    case "flag":
      return "";
  }
}
