// Quizzes a buddy makes for a child. The child asks in a chat ("make me a quiz about that"); the check model works out
// the topic and style, and asks multiple choice or typed answers if they didn't say. The tutor model writes the quiz
// against QUIZ_SCHEMA, and this file checks it in code (the shape, real choices, the right answer among them) and that
// it doesn't hand over the answer to the child's actual homework problem. Quizzes are kept in the database with their
// answers; the child's device only ever gets the questions, and answers are checked here: one retry per question, then
// the answer and its explanation.

import type { ChatItem, QuizAnswerResult, QuizQuestionView, QuizReview, QuizStyle } from "../shared/protocol.js";
import type { StructuredCaller } from "./classifier.js";
import { allowanceFor, appOn, type AppConfig, type Household } from "./config.js";
import type { Db } from "./db.js";
import { QUIZ_REQUEST_SCHEMA, QUIZ_REQUEST_SYSTEM, QUIZ_SCHEMA, QUIZ_SYSTEM, sanitiseChildText } from "./prompts.js";

export interface QuizQuestion {
  question: string;
  /** Multiple choice: the options, one of them `answer`. Single answer: null. */
  choices: string[] | null;
  answer: string;
  /** Other right ways to write a single answer. */
  accept: string[];
  hint: string;
  explanation: string;
}

export const QUIZ_LIMITS = { min: 3, max: 12, tries: 2 };

const clean = (s: unknown, max: number) => (typeof s === "string" ? sanitiseChildText(s).replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A quiz as the model wrote it, checked: right shape, real choices with the answer among them. Null if unusable. */
export function checkQuiz(raw: any, style: QuizStyle, count: number): { title: string; questions: QuizQuestion[] } | null {
  const title = clean(raw?.title, 60);
  const questions: QuizQuestion[] = [];
  for (const q of Array.isArray(raw?.questions) ? raw.questions : []) {
    const question = clean(q?.question, 300);
    const answer = clean(q?.answer, 120);
    const explanation = clean(q?.explanation, 400);
    if (!question || !answer || !explanation) continue;
    const hint = clean(q?.hint, 200);
    if (style === "multiple_choice") {
      const choices = [...new Set((Array.isArray(q?.choices) ? q.choices : []).map((c: unknown) => clean(c, 120)).filter(Boolean) as string[])];
      if (choices.length < 3 || choices.length > 5 || !choices.includes(answer)) continue;
      questions.push({ question, choices, answer, accept: [], hint, explanation });
    } else {
      if (answer.length > 60) continue;
      const accept = (Array.isArray(q?.accept) ? q.accept : []).map((a: unknown) => clean(a, 60)).filter(Boolean).slice(0, 6) as string[];
      questions.push({ question, choices: null, answer, accept, hint, explanation });
    }
  }
  if (!title || questions.length < QUIZ_LIMITS.min) return null;
  return { title, questions: questions.slice(0, Math.min(count, QUIZ_LIMITS.max)) };
}

/** What the child asked for: the topic, style (null: ask them) and how many questions. */
export async function readQuizRequest(caller: StructuredCaller, conversation: { role: "child" | "tutor"; text: string }[]) {
  const chat = conversation
    .slice(-12)
    .map((t) => `${t.role === "child" ? "Child" : "Buddy"}: ${sanitiseChildText(t.text).slice(0, 500)}`)
    .join("\n");
  const res = await caller.completeStructured<{ topic?: string; style?: string | null; count?: number }>({
    system: QUIZ_REQUEST_SYSTEM,
    user: `The chat:\n"""\n${chat}\n"""`,
    toolName: "quiz_request",
    description: "Record the quiz they want",
    schema: QUIZ_REQUEST_SCHEMA,
    model: "check",
    maxTokens: 200,
  });
  const v = res.value ?? {};
  const style: QuizStyle | null = v.style === "multiple_choice" || v.style === "single_answer" ? v.style : null;
  const count = Number.isInteger(v.count) ? Math.min(QUIZ_LIMITS.max, Math.max(QUIZ_LIMITS.min, v.count!)) : 6;
  return { topic: clean(v.topic, 80) || "what we've been learning", style, count, tokens: res.tokens };
}

/** Write the quiz with the tutor model. Null if it couldn't be made into a usable quiz. */
export async function writeQuiz(
  caller: StructuredCaller,
  req: { topic: string; style: QuizStyle; count: number; conversation: { role: "child" | "tutor"; text: string }[]; skill: string; avoid?: string },
) {
  const chat = req.conversation
    .slice(-12)
    .map((t) => `${t.role === "child" ? "Child" : "Buddy"}: ${sanitiseChildText(t.text).slice(0, 500)}`)
    .join("\n");
  const res = await caller.completeStructured<any>({
    system: `${QUIZ_SYSTEM}\n\n${req.skill.trim()}`,
    user: [
      `Topic: ${req.topic}`,
      `Style: ${req.style === "multiple_choice" ? "multiple choice, 4 options each" : "single answer, typed"}`,
      `Questions: ${req.count}`,
      req.avoid ? `Don't include this question or anything that answers it (it's their homework): """${req.avoid.slice(0, 300)}"""` : "",
      `The recent chat, for context:\n"""\n${chat}\n"""`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    toolName: "quiz",
    description: "Record the quiz",
    schema: QUIZ_SCHEMA,
    model: "tutor",
    maxTokens: 3500,
  });
  return { quiz: checkQuiz(res.value, req.style, req.count), tokens: res.tokens };
}

/** Everything the child could see in a quiz, for the leak check against their homework problem. */
export const quizText = (questions: QuizQuestion[]) =>
  questions.map((q, i) => `${i + 1}. ${q.question}${q.choices ? ` (${q.choices.join(" / ")})` : ""} Answer: ${q.answer}. ${q.explanation}`).join("\n");

// ---- answering ----

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9./%-]+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "")
    .replace(/\.$/, "");

/** A number written as 0.5, 1/2 or 50%, or null. */
function numberOf(s: string): number | null {
  const t = norm(s).replace(/\s+/g, "");
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(-?\d+(?:\.\d+)?)%$/))) return Number(m[1]) / 100;
  if ((m = t.match(/^(-?\d+)\/(\d+)$/))) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
}

/** Whether a typed (or picked) answer is right: the same words, or the same number written another way. */
export function isRight(q: QuizQuestion, given: string): boolean {
  if (q.choices) return given.trim() === q.answer;
  const g = norm(given);
  if (!g) return false;
  const right = [q.answer, ...q.accept];
  if (right.some((r) => norm(r) === g)) return true;
  const n = numberOf(given);
  return n !== null && right.some((r) => {
    const v = numberOf(r);
    return v !== null && Math.abs(v - n) < 1e-6;
  });
}

export interface AttemptState {
  tries: string[];
  correct: boolean;
  done: boolean;
}

/** Check an answer to question `n`: one retry, then the answer and explanation. Returns the new state and what to show. */
export function answer(q: QuizQuestion, state: AttemptState | undefined, given: string): { state: AttemptState; result: QuizAnswerResult } | null {
  const s = state ?? { tries: [], correct: false, done: false };
  if (s.done) return null;
  const tries = [...s.tries, given.slice(0, 120)];
  const correct = isRight(q, given);
  const done = correct || tries.length >= QUIZ_LIMITS.tries;
  const result: QuizAnswerResult = done ? { correct, done, answer: q.answer, explanation: q.explanation } : { correct, done, ...(q.hint ? { hint: q.hint } : {}) };
  return { state: { tries, correct, done }, result };
}

/** The questions as the child sees them: no answers, choices in a fresh order. */
export function questionViews(questions: QuizQuestion[]): QuizQuestionView[] {
  return questions.map((q) => ({ question: q.question, choices: q.choices ? [...q.choices].sort(() => Math.random() - 0.5) : null }));
}

export function review(questions: QuizQuestion[], states: (AttemptState | undefined)[]): QuizReview {
  const rows = questions.map((q, i) => ({ question: q.question, tries: states[i]?.tries ?? [], correct: !!states[i]?.correct, answer: q.answer, explanation: q.explanation }));
  return { score: rows.filter((r) => r.correct).length, total: rows.length, questions: rows };
}

// ---- making quizzes ----

export interface QuizMakerDeps {
  db: Db;
  household: () => Household;
  /** The check model (reading the request) and the tutor model (writing the quiz). */
  check: StructuredCaller;
  tutor: StructuredCaller;
  /** The answer-leak check, against the child's active homework problem. */
  leakCheck: (problem: string, text: string) => Promise<{ gives_answer: boolean; tokens: number }>;
  /** Say something in the buddy's chat in `app`, with an item (the finished quiz's card). */
  post: (childId: string, buddyId: number, app: string, text: string, item?: ChatItem) => void;
  /** A buddy's quizzes changed. */
  changed: (childId: string, buddyId: number) => void;
  /** The buddy started (a topic) or finished (null) writing a quiz in `app`'s chat. */
  making?: (childId: string, buddyId: number, app: string, quiz: { topic: string; count: number } | null) => void;
  log?: (msg: string) => void;
}

export class QuizMaker {
  /** Quizzes being written right now, so a chat opened meanwhile shows the buddy at work. */
  private writing = new Map<number, { childId: string; buddyId: number; app: string; topic: string; count: number }>();

  constructor(private deps: QuizMakerDeps) {}

  /** The quiz being written in a buddy's chat, if any. */
  making(childId: string, buddyId: number | null, app: string): { topic: string; count: number } | null {
    for (const q of this.writing.values()) if (q.childId === childId && q.buddyId === buddyId && q.app === app) return { topic: q.topic, count: q.count };
    return null;
  }

  /** The Quizzes app, if it's on for the child. */
  app(childId: string): AppConfig | null {
    const household = this.deps.household();
    const child = household.children.get(childId);
    const app = [...household.apps.values()].find((a) => a.kind === "quiz");
    return child && app && appOn(child, app) ? app : null;
  }

  /**
   * The child asked for a quiz in a chat: work out what about, then make it (or ask the style first). Returns what the
   * buddy says, and the offer to show when it's asking.
   */
  async request(childId: string, buddyId: number, app: string, conversation: { role: "child" | "tutor"; text: string }[]) {
    const { db } = this.deps;
    const household = this.deps.household();
    const child = household.children.get(childId);
    if (!child || !this.app(childId)) return { reply: `Quizzes aren't switched on for you yet. Ask ${household.config.parent.title}!`, offer: null, tokens: 0 };
    if (db.usageToday(childId) >= allowanceFor(household, child)) return { reply: "I'm resting until tomorrow, so let's make that quiz then!", offer: null, tokens: 0 };
    const req = await readQuizRequest(this.deps.check, conversation);
    const id = db.addQuiz({ childId, buddyId, app, topic: req.topic, style: req.style, count: req.count });
    this.deps.changed(childId, buddyId);
    if (!req.style) {
      return { reply: `A quiz about ${req.topic}! Do you want multiple choice, or to type your answers?`, offer: { quizId: id, topic: req.topic }, tokens: req.tokens };
    }
    void this.make(id, conversation);
    return { reply: `Making you a quiz about ${req.topic}! It'll pop up here when it's ready.`, offer: null, tokens: req.tokens };
  }

  /** The child picked the style for an offered quiz. False if it's not theirs or already chosen. */
  choose(childId: string, quizId: number, style: QuizStyle): boolean {
    const { db } = this.deps;
    const quiz = db.quiz(quizId);
    if (!quiz || quiz.childId !== childId || quiz.status !== "offered" || (style !== "multiple_choice" && style !== "single_answer")) return false;
    db.setQuizStyle(quizId, style);
    this.deps.post(childId, quiz.buddyId, quiz.app, style === "multiple_choice" ? "Multiple choice it is! Making it now…" : "Typed answers it is! Making it now…");
    this.deps.changed(childId, quiz.buddyId);
    const session = db.latestSession(childId, quiz.app, quiz.buddyId);
    void this.make(quizId, session ? db.transcript(session.id).map((t) => ({ role: t.role, text: t.text })) : []);
    return true;
  }

  /** Write the quiz, check it, keep it, and announce it in the chat. Never throws. */
  async make(quizId: number, conversation: { role: "child" | "tutor"; text: string }[]): Promise<void> {
    const { db } = this.deps;
    const quiz = db.quiz(quizId);
    if (!quiz?.style || this.writing.has(quizId)) return;
    let tokens = 0;
    this.writing.set(quizId, { childId: quiz.childId, buddyId: quiz.buddyId, app: quiz.app, topic: quiz.topic, count: quiz.count });
    this.deps.making?.(quiz.childId, quiz.buddyId, quiz.app, { topic: quiz.topic, count: quiz.count });
    try {
      const skill = this.app(quiz.childId)?.skill ?? "";
      const problem = db.activeProblem(quiz.childId, quiz.buddyId)?.text ?? null;
      let made = null;
      // Written once, and again if it gave away their homework problem's answer.
      for (let i = 0; i < 2 && !made; i++) {
        const res = await writeQuiz(this.deps.tutor, { topic: quiz.topic, style: quiz.style, count: quiz.count, conversation, skill, avoid: problem && i > 0 ? problem : undefined });
        tokens += res.tokens;
        if (!res.quiz) continue;
        if (problem) {
          const leak = await this.deps.leakCheck(problem, quizText(res.quiz.questions));
          tokens += leak.tokens;
          if (leak.gives_answer) continue;
        }
        made = res.quiz;
      }
      db.setQuizMade(quizId, made);
      if (made) {
        this.deps.post(quiz.childId, quiz.buddyId, quiz.app, `Your quiz is ready: "${made.title}"!`, {
          kind: "quiz",
          quizId,
          title: made.title,
          count: made.questions.length,
          style: quiz.style,
        });
      } else {
        this.deps.post(quiz.childId, quiz.buddyId, quiz.app, "I couldn't make that quiz this time. Shall we try a different topic?");
      }
    } catch (e) {
      this.deps.log?.(`quiz ${quizId} failed: ${(e as Error).message}`);
      db.setQuizMade(quizId, null);
      this.deps.post(quiz.childId, quiz.buddyId, quiz.app, "I couldn't make that quiz this time. Shall we try again in a bit?");
    } finally {
      this.writing.delete(quizId);
      this.deps.making?.(quiz.childId, quiz.buddyId, quiz.app, null);
      db.addUsage(quiz.childId, tokens);
      this.deps.changed(quiz.childId, quiz.buddyId);
    }
  }
}
