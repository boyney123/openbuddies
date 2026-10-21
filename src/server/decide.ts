// decide() turns classifier labels plus ladder state into the action for this turn.
// Pure: no I/O, no model calls. Every branch is covered by test/decide.test.ts.

import type { Rung } from "../shared/protocol.js";
import { modeFor, type AppConfig, type ChildRules, type Mode, type Subject } from "./config.js";

export const INTENTS = ["learn_concept", "wants_answer", "check_my_work", "stuck", "general", "schedule", "quiz", "off_topic", "chat"] as const;
export const PRESSURES = ["none", "mild", "jailbreak"] as const;
export const WELFARES = ["fine", "upset", "concerning"] as const;
export type IntentLabel = (typeof INTENTS)[number];
export type Pressure = (typeof PRESSURES)[number];
export type Welfare = (typeof WELFARES)[number];

export interface Intent {
  intent: IntentLabel;
  pressure: Pressure;
  subject: Subject;
  welfare: Welfare;
  problem: string | null;
  /** Ids of the buddy's files the message refers to ("our history homework"), most likely first. */
  files?: number[];
  /** A web search query, when the question needs looking up (web.ts). */
  lookup?: string | null;
}

export type ActionKind = "ask" | "nudge" | "worked_example" | "check_answer" | "explain" | "help" | "schedule" | "quiz" | "redirect" | "welfare_response" | "reveal";

export interface Action {
  kind: ActionKind;
  /** The highest ladder rung tools may use this turn. Null when no problem is active. */
  rung: Rung | null;
  mode: Mode;
  subject: Subject;
  /** Run the leak check on drafts. Off only in Relaxed mode or after real effort in Balanced mode. */
  enforce: boolean;
  /** The tutor may state the final answer (with its working). */
  mayRevealAnswer: boolean;
  /** Child seems upset: be extra gentle. */
  gentle: boolean;
  /** Child is pressing for the answer: stay kind and firm. */
  firm: boolean;
  newProblem: boolean;
  /** A previous draft this turn was blocked for giving the answer away. */
  avoid?: string;
}

export interface LadderState {
  /** The active problem after new-problem handling, or null if none yet. */
  problem: { rung: Rung; attempts: number; correct: boolean; subject: string | null } | null;
  isNewProblem: boolean;
}

/** The escalation rungs in order (check is where answers are checked, not a hint). */
export function escalationLadder(rules: ChildRules): Rung[] {
  const ladder = (["ask", "nudge", "worked_example"] as Rung[]).filter((r) => rules.hint_ladder.includes(r));
  return ladder.length ? ladder : ["ask"];
}

/** Move up one rung, never past worked_example (or the top of a shorter configured ladder). */
export function nextRung(current: Rung, ladder: Rung[]): Rung {
  if (current === "check") return ladder.includes("nudge") ? "nudge" : ladder[ladder.length - 1];
  const i = ladder.indexOf(current);
  if (i < 0) return ladder[0];
  return ladder[Math.min(i + 1, ladder.length - 1)];
}

/** Hold position under jailbreak pressure. From check, the lowest real hint is the nearest equivalent. */
export function holdRung(current: Rung, ladder: Rung[]): Rung {
  if (current === "check") return ladder.includes("nudge") ? "nudge" : ladder[0];
  return ladder.includes(current) ? current : ladder[0];
}

export function decide(intent: Intent, state: LadderState, rules: ChildRules, app: Pick<AppConfig, "hint_ladder"> & Partial<Pick<AppConfig, "kind">>): Action {
  const subject = intent.subject;
  const mode = modeFor(rules, subject !== "other" ? subject : state.problem?.subject);
  const ladder = escalationLadder(rules);
  const current: Rung | null = state.problem?.rung ?? null;
  const base = {
    mode,
    subject,
    enforce: mode !== "relaxed",
    mayRevealAnswer: mode === "relaxed",
    gentle: intent.welfare === "upset",
    firm: intent.pressure !== "none",
    newProblem: state.isNewProblem,
  };

  if (intent.welfare === "concerning") return { ...base, kind: "welfare_response", rung: current };

  // In a studio (Picture Studio) the chat is the activity: describing a picture isn't off topic. Answers are still
  // guarded by the leak check if there's ever a homework problem.
  if (app.kind === "studio" && intent.intent !== "schedule" && intent.intent !== "quiz") return { ...base, kind: "help", rung: current };

  switch (intent.intent) {
    case "check_my_work":
      return { ...base, kind: "check_answer", rung: "check" };

    case "off_topic":
    case "chat":
      return { ...base, kind: "redirect", rung: current };

    case "learn_concept":
      return { ...base, kind: "explain", rung: current };

    // Not a homework problem (their deadlines, planning, study tips, the app): just help. The leak check still guards
    // any active problem, so this can't be used to get its answer.
    case "general":
      return { ...base, kind: "help", rung: current };

    // A reminder or plan: the pipeline turns it into a schedule for the child to confirm (schedules.ts).
    case "schedule":
      return { ...base, kind: "schedule", rung: current };

    // A quiz: the pipeline asks what kind, then makes it in the background (quizzes.ts).
    case "quiz":
      return { ...base, kind: "quiz", rung: current };

    case "wants_answer":
    case "stuck": {
      if (mode === "relaxed") return { ...base, kind: "explain", rung: current };
      if (mode === "balanced" && (state.problem?.attempts ?? 0) >= 2) {
        return { ...base, kind: "reveal", rung: current, enforce: false, mayRevealAnswer: true };
      }
      if (!app.hint_ladder) return { ...base, kind: "explain", rung: current };
      let rung: Rung;
      if (!state.problem || state.isNewProblem || current === null) rung = ladder[0];
      else if (intent.pressure === "jailbreak") rung = holdRung(current, ladder);
      else rung = nextRung(current, ladder);
      return { ...base, kind: rung as "ask" | "nudge" | "worked_example", rung };
    }
  }
}

/** The rung the problem sits on after this turn. Redirects, explanations and welfare turns leave it alone. */
export function advance(problemRung: Rung, action: Action): Rung {
  if (action.kind === "ask" || action.kind === "nudge" || action.kind === "worked_example" || action.kind === "check_answer") {
    return action.rung ?? problemRung;
  }
  return problemRung;
}

/** The ladder index of a rung, for guards comparing "at or below". */
export function rungIndex(r: Rung): number {
  return ["ask", "nudge", "worked_example", "check"].indexOf(r);
}
