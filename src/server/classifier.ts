// The decision layer's model calls: label each child message, and check each draft for a leaked answer.
// Pluggable: anything implementing Classifier can replace the default (e.g. a dedicated classification model).

import type { Subject } from "./config.js";
import { INTENTS, PRESSURES, WELFARES, type Intent } from "./decide.js";
import { classifierSchema, CLASSIFIER_SYSTEM, classifierUser, LEAK_SCHEMA, LEAK_SYSTEM, leakUser } from "./prompts.js";

export interface ClassifyState {
  activeProblem: string | null;
  activeSubject: string | null;
  /** The child's configured subjects. The classifier picks one of these, or "other". */
  subjects: Subject[];
  /** The child's last few messages, oldest first, for context. */
  recent: string[];
  /** The subject the child's current buddy specialises in, if any. The default when the subject is unclear. */
  buddySubject?: Subject | null;
  /** The buddy's files the message might refer to (see fileCandidates), so the classifier can pick them out. */
  files?: { id: number; name: string; summary: string | null; createdAt: string }[];
  /** The child may have things looked up on the internet: ask for a search query when one is needed. */
  web?: boolean;
}

export interface LeakVerdict {
  gives_answer: boolean;
  reason: string;
}

export interface Classifier {
  classify(text: string, state: ClassifyState): Promise<{ intent: Intent; tokens: number; error?: string }>;
  leakCheck(problem: string, draft: string, childText: string): Promise<LeakVerdict & { tokens: number }>;
}

/** What the default classifier needs from the model adapter. */
export interface StructuredCaller {
  completeStructured<T>(req: {
    system: string;
    user: string;
    toolName: string;
    description: string;
    schema: Record<string, unknown>;
    model: "check" | "tutor";
    maxTokens?: number;
    images?: { data: string; mimeType: string }[];
  }): Promise<{ value: T | null; tokens: number; error?: string }>;
}

// A deterministic backstop: some phrases always mean "concerning", whatever the model said.
const CONCERNING = [
  /\b(kill|hurt|harm|cut)(ing)?\s+(myself|me)\b/i,
  /\bsuicid/i,
  /\b(want|wanna|going)\s+(to\s+)?die\b/i,
  /\bwish\s+i\s+(was|were)\s+(dead|never born)\b/i,
  /\bend\s+(it|my life)\b/i,
  /\bno\s*(one|body)\s+would\s+(miss|care)\b/i,
  /\b(he|she|they)\s+(hits?|hurts?|touch(es)?)\s+me\b/i,
  /\bkeep\s+(it\s+)?(a\s+)?secret\s+from\s+(my\s+)?(mum|mom|dad|parents?)\b/i,
];
const UPSET = [/\b(i'?m|i am)\s+(so\s+)?(stupid|dumb|useless|an idiot)\b/i, /\bcrying\b/i, /\bi\s+hate\s+(myself|school|my life)\b/i, /\bscared\b/i];

export function welfareBackstop(text: string): "fine" | "upset" | "concerning" {
  if (CONCERNING.some((r) => r.test(text))) return "concerning";
  if (UPSET.some((r) => r.test(text))) return "upset";
  return "fine";
}

const rank = { fine: 0, upset: 1, concerning: 2 } as const;
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Coerce raw model output into a valid Intent. Unknown values fall back to the cautious choice. */
export function coerceIntent(raw: any, text: string, state: ClassifyState): Intent {
  const modelWelfare = pick(raw?.welfare, WELFARES, "fine");
  const backstop = welfareBackstop(text);
  return {
    intent: pick(raw?.intent, INTENTS, "stuck"),
    pressure: pick(raw?.pressure, PRESSURES, "none"),
    subject: pick<Subject>(raw?.subject, [...state.subjects, "other"], state.activeSubject ?? state.buddySubject ?? "other"),
    welfare: rank[backstop] > rank[modelWelfare] ? backstop : modelWelfare,
    problem: typeof raw?.problem === "string" && raw.problem.trim() ? raw.problem.trim().slice(0, 2000) : null,
    // Only files that were offered, and at most two: the classifier picks, the server decides what it may pick from.
    lookup: state.web && typeof raw?.lookup === "string" && raw.lookup.trim() ? raw.lookup.replace(/\s+/g, " ").trim().slice(0, 120) : null,
    files: Array.isArray(raw?.files) ? [...new Set(raw.files.filter((id: unknown) => state.files?.some((f) => f.id === id)) as number[])].slice(0, 2) : [],
  };
}

export class DefaultClassifier implements Classifier {
  constructor(private model: StructuredCaller) {}

  async classify(text: string, state: ClassifyState) {
    const res = await this.model.completeStructured<any>({
      system: CLASSIFIER_SYSTEM,
      user: classifierUser(text, state.activeProblem, state.recent, state.subjects, state.buddySubject ?? null, state.files ?? []),
      toolName: "label_message",
      description: "Record the labels for the child's message.",
      schema: classifierSchema(state.subjects, !!state.files?.length, !!state.web),
      model: "check",
    });
    // On failure keep the active problem and assume "stuck": the cautious path through decide().
    const raw = res.value ?? { intent: "stuck", pressure: "none", subject: state.activeSubject ?? state.buddySubject ?? null, welfare: "fine", problem: state.activeProblem };
    return { intent: coerceIntent(raw, text, state), tokens: res.tokens, error: res.error };
  }

  async leakCheck(problem: string, draft: string, childText: string) {
    const res = await this.model.completeStructured<LeakVerdict>({
      system: LEAK_SYSTEM,
      user: leakUser(problem, childText, draft),
      toolName: "leak_verdict",
      description: "Record whether the draft gives the answer away.",
      schema: LEAK_SCHEMA,
      model: "check",
      maxTokens: 300,
    });
    // Fail closed: if the check can't run, treat the draft as a leak.
    if (!res.value || typeof res.value.gives_answer !== "boolean") {
      return { gives_answer: true, reason: `leak check unavailable (${res.error ?? "invalid output"}); blocked to be safe`, tokens: res.tokens };
    }
    return { gives_answer: res.value.gives_answer, reason: String(res.value.reason ?? "").slice(0, 500), tokens: res.tokens };
  }
}
