// Every child message runs through handleMessage(). The model never polices itself: the classifier labels the
// message, decide() (plain code) picks the action, tools are guarded against that action, and a separate leak check
// blocks any draft that gives the answer away before the child can see it.

import type { ChatItem, ProblemView, Schedule, ServerEvent } from "../shared/protocol.js";
import { FILE_LIMITS } from "../shared/protocol.js";
import { personaFor } from "./buddies.js";
import { buildCatalogue, fileCandidates } from "./files.js";
import { memoryBlock, readMemory, type MemoryKeeper } from "./memory.js";
import { schedulesBlock } from "./schedules.js";
import type { Classifier } from "./classifier.js";
import { allowanceFor, appOn, withinHours, type Child, type Household } from "./config.js";
import { lookupBlock, type Lookup } from "./web.js";
import { picturePrompt, type PicturePlan } from "./pictures.js";
import type { Db, FileRow, ProblemRow } from "./db.js";
import { advance, decide, type Action, type Intent, type LadderState } from "./decide.js";
import { fenceMaterial, newFenceId, SAFE_FALLBACK } from "./prompts.js";
import { sameProblem, type ToolEffect } from "./tools.js";
import type { Draft, RespondInput } from "./agent.js";

export interface Tutor {
  respond(input: RespondInput): Promise<Draft>;
}

export interface PipelineDeps {
  db: Db;
  tutor: Tutor;
  classifier: Classifier;
  household: () => Household;
  /** Send an event to every connected device of a child. */
  emit: (childId: string, event: ServerEvent) => void;
  /** Keeps each buddy's memory notes up to date. Absent: no memory. */
  memory?: MemoryKeeper;
  /** Looking things up on the internet (web.ts). Absent: never. */
  web?: { available(): boolean; lookUp(child: Child, question: string, query: string): Promise<Lookup> };
  /** Picture Studio (pictures.ts). Absent: "Make it" says pictures aren't set up. */
  pictures?: {
    available(): boolean;
    plan(conversation: { role: "child" | "tutor"; text: string }[], last: { title: string; prompt: string } | null): Promise<PicturePlan>;
    /** Draw, or change `base` (the last picture). */
    draw(prompt: string, base?: { data: Buffer; mime: string }): Promise<{ data: Buffer; mime: string }>;
    /** A kept picture's bytes, to change it. */
    load(fileId: number): { data: Buffer; mime: string } | null;
    /** Keep a picture in the buddy's files. Returns its id, or an error for the child. */
    keep(childId: string, buddyId: number, image: { data: Buffer; mime: string }, title: string, prompt: string): { id: number; name: string } | { error: string };
  };
  /** Quizzes (quizzes.ts). Absent: asking for one gets a polite "can't". */
  quizzes?: {
    request(childId: string, buddyId: number, app: string, conversation: { role: "child" | "tutor"; text: string }[]): Promise<{ reply: string; offer: { quizId: number; topic: string } | null; tokens: number }>;
  };
  /** Reminders and plans (schedules.ts). Absent: asking for one gets a polite "can't". */
  schedules?: {
    propose(childId: string, buddyId: number, text: string): Promise<{ schedule: Schedule | null; reply: string; tokens: number }>;
    list(childId: string): Schedule[];
  };
  /** Delay between streamed chunks of an approved reply, in ms. 0 in tests. */
  streamDelayMs?: number;
  log?: (msg: string) => void;
}

export interface TurnResult {
  reply: string;
  intent: Intent | null;
  action: Action | null;
  blocked: { text: string; reason: string }[];
  fallback: boolean;
  effects: ToolEffect[];
}

// "Remember my test is on Friday", "don't forget…", but not "I can't remember how to do this".
/** Intents that are about a piece of homework, so a message with no named problem is treated as the problem itself. */
const HOMEWORK_INTENTS = new Set<Intent["intent"]>(["wants_answer", "stuck", "check_my_work", "learn_concept"]);

export const ASKS_TO_REMEMBER =
  /(?<!\b(?:can'?t|cannot|don'?t|didn'?t|couldn'?t|not|never|i)\s)\bremember (?:that|this|my|me|i|we|to|for|it)\b|\bdon'?t forget\b|\bmake a note\b|\b(?:note|write) (?:it|this|that) down\b/i;

/** Pictures made in a studio chat so far, for the buddy. */
function madePictures(turns: { role: string; text: string }[], fenceId: string): string | null {
  const titles = turns.filter((t) => t.role === "tutor" && t.text.startsWith("[Made a picture #")).map((t) => `- ${t.text.replace(/^\[Made a picture #\d+: /, "").slice(0, -1)}`);
  return titles.length ? fenceMaterial(fenceId, "Pictures made in this chat so far (the child can see them; the last is the newest):", titles.join("\n")) : null;
}

/** Events that belong to one app's chat. */
const CHAT_EVENTS = new Set<string>(["items", "problem", "thinking", "painting", "quizzing", "reply_delta", "reply_end", "error"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function problemView(p: ProblemRow | null): ProblemView | null {
  return p ? { label: p.label, text: p.text, rung: p.rung, solved: !!p.solved_at } : null;
}

/** The short, quote-free summary kept for a welfare label: never the child's words. */
function welfareSummary(childName: string, welfare: "upset" | "concerning", appName: string): { summary: string; severity: "medium" | "high" } {
  return welfare === "concerning"
    ? { summary: `Something ${childName} wrote in ${appName} may be worrying. Please check in with them.`, severity: "high" }
    : { summary: `${childName} seems frustrated or upset during ${appName}. You may want to check in.`, severity: "medium" };
}

function labelFor(text: string): string {
  const firstLine = text.split("\n")[0].trim();
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
}

/** A child message, saved and shown in the chat, waiting for the buddy. */
interface Received {
  turnId: number;
  text: string;
  shared: FileRow[];
  /** A plan going off: the "message" is what the child asked the buddy to do at this time. */
  scheduled?: Schedule;
}

/** Messages that arrived while the buddy was busy, answered together in one turn. */
interface Batch {
  appId: string;
  buddyId: number | null;
  messages: Received[];
  result: Promise<TurnResult>;
}

export class Pipeline {
  private queues = new Map<string, Promise<unknown>>();
  private waiting = new Map<string, Batch>();

  constructor(private deps: PipelineDeps) {}

  /**
   * Handle one message, in the chat with `buddyId` (null: no buddy). It shows in the chat straight away. Messages from
   * the same child run one at a time, and any that arrive before the buddy gets to them are answered together: kids
   * send "wait", "no", "i meant 3/4" in a burst, and one reply to the whole thought is better (and cheaper) than one
   * each. Every message in a batch resolves to the same result.
   */
  handleMessage(childId: string, appId: string, text: string, buddyId: number | null = null, fileIds: number[] = [], scheduled?: Schedule): Promise<TurnResult> {
    let message: Received;
    try {
      message = this.receive(childId, appId, text, buddyId, fileIds, scheduled);
    } catch (e) {
      return Promise.reject(e);
    }
    // A plan going off is a turn of its own: it never joins the child's messages, and they never join it.
    const open = scheduled ? undefined : this.waiting.get(childId);
    if (open && open.appId === appId && open.buddyId === buddyId) {
      open.messages.push(message);
      return open.result;
    }
    const prev = this.queues.get(childId) ?? Promise.resolve();
    const batch: Batch = { appId, buddyId, messages: [message], result: null as unknown as Promise<TurnResult> };
    if (!scheduled) this.waiting.set(childId, batch);
    batch.result = prev
      .catch(() => {})
      .then(() => {
        if (this.waiting.get(childId) === batch) this.waiting.delete(childId);
        return this.run(childId, appId, batch.messages, buddyId);
      });
    this.queues.set(childId, batch.result);
    return batch.result;
  }

  /** Send to the child's devices, unless they've switched to a different buddy since this message was sent. */
  /**
   * Send to the child's devices, unless they've switched to a different buddy since this message was sent. Chat events
   * say which app's chat they're for, so a device showing another app's chat leaves them out.
   */
  /** The chat shows the buddy making a quiz while it's written. */
  quizzing(childId: string, buddyId: number, app: string, quiz: { topic: string; count: number } | null) {
    this.emitFor(childId, buddyId, quiz ? { type: "quizzing", on: true, ...quiz } : { type: "quizzing", on: false }, app);
  }

  private emitFor(childId: string, buddyId: number | null, event: ServerEvent, app?: string) {
    if (buddyId !== null && this.deps.db.activeBuddyId(childId) !== buddyId) return;
    this.deps.emit(childId, app && "type" in event && CHAT_EVENTS.has(event.type) ? ({ ...event, app } as ServerEvent) : event);
  }

  private publish(childId: string, buddyId: number | null, sessionId: number, turnId: number, item: ChatItem, reset = false) {
    const seq = this.deps.db.appendUi(childId, sessionId, item, turnId);
    this.emitFor(childId, buddyId, { type: "items", items: [seq], reset }, this.deps.db.sessionApp(sessionId));
  }

  private async streamText(childId: string, buddyId: number | null, app: string, id: string, text: string) {
    const parts = text.match(/\S+\s*/g) ?? [text];
    for (let i = 0; i < parts.length; i += 4) {
      this.emitFor(childId, buddyId, { type: "reply_delta", id, text: parts.slice(i, i + 4).join("") }, app);
      if (this.deps.streamDelayMs) await sleep(this.deps.streamDelayMs);
    }
    this.emitFor(childId, buddyId, { type: "reply_end", id }, app);
  }

  /**
   * Picture Studio, before the reply: the check model decides from the chat whether to draw (a new picture, or a
   * change to the last), decline kindly, or let the buddy reply as usual. Returns what the buddy said when it handled
   * the turn, else null.
   */
  private async studioTurn(childId: string, buddyId: number | null, appId: string, sessionId: number, child: Child, action: Action): Promise<{ done: string | null; tokens: number }> {
    const { db } = this.deps;
    const pictures = this.deps.pictures!;
    const turns = db.transcript(sessionId);
    // The last picture made in this chat, if it's still there, so "add a dog to it" changes that one.
    const lastId = [...turns].reverse().map((t) => (t.role === "tutor" ? /^\[Made a picture #(\d+): /.exec(t.text)?.[1] : undefined)).find(Boolean);
    const lastFile = lastId ? db.fileById(Number(lastId)) : null;
    const last = lastFile && lastFile.childId === childId && lastFile.buddyId === buddyId ? lastFile : null;
    const plan = await pictures.plan(
      turns.map((t) => ({ role: t.role, text: t.text })),
      last ? { title: (last.summary ?? last.name).replace(/^Picture: /, ""), prompt: (last.text ?? "").replace(/^A picture made in Picture Studio, showing: /, "") } : null,
    );
    if (plan.action === "chat" || buddyId === null) return { done: null, tokens: plan.tokens };
    const say = (text: string) => {
      const turnId = db.insertTurn({ sessionId, role: "tutor", text, action });
      this.publish(childId, buddyId, sessionId, turnId, { kind: "tutor", text });
      return { done: text, tokens: plan.tokens };
    };
    if (plan.action === "decline") return say(plan.say);
    if (db.picturesToday(childId) >= child.rules.pictures.daily) return say("That's all your pictures for today! Let's make more tomorrow.");

    say(plan.say);
    // The chat shows the buddy painting while the image model works.
    this.emitFor(childId, buddyId, { type: "thinking", on: false }, appId);
    this.emitFor(childId, buddyId, { type: "painting", on: true, title: plan.title }, appId);
    const base = plan.edit && last ? (pictures.load(last.id) ?? undefined) : undefined;
    const image = await pictures
      .draw(picturePrompt(plan.prompt), base)
      .catch((e) => {
        this.deps.log?.(`picture failed for ${childId}: ${(e as Error).message}`);
        return null;
      })
      .finally(() => this.emitFor(childId, buddyId, { type: "painting", on: false }, appId));
    if (!image) return say("That one didn't work out. Shall we try a different idea?");
    const kept = pictures.keep(childId, buddyId, image, plan.title, plan.prompt);
    if ("error" in kept) return say(kept.error);
    db.addPicture(childId);
    const turnId = db.insertTurn({ sessionId, role: "tutor", text: `[Made a picture #${kept.id}: ${plan.title}]`, action });
    this.publish(childId, buddyId, sessionId, turnId, { kind: "picture", file: { id: kept.id, name: kept.name, kind: "image" }, title: plan.title });
    return { done: plan.say, tokens: plan.tokens };
  }

  /** A plan going off as a buddy turn: shown as the reminder card, then answered like a message from the child. */
  runScheduled(childId: string, appId: string, schedule: Schedule): Promise<TurnResult> {
    return this.handleMessage(childId, appId, schedule.text, schedule.buddyId, [], schedule);
  }

  /** The buddy saying something in its chat in `app` on its own (a finished quiz, a result), with an item to show. */
  post(childId: string, buddyId: number, app: string, text: string, item?: ChatItem) {
    const { db } = this.deps;
    const { session, created } = db.currentSession(childId, app, this.deps.household().config.session_idle_minutes, buddyId);
    const turnId = db.insertTurn({ sessionId: session.id, role: "tutor", text });
    this.publish(childId, buddyId, session.id, turnId, { kind: "tutor", text }, created);
    if (item) this.publish(childId, buddyId, session.id, turnId, item);
  }

  /** The buddy checking in (the daily heartbeat): its message in its Homework chat. */
  checkIn(childId: string, buddyId: number, text: string) {
    const { db } = this.deps;
    const { session, created } = db.currentSession(childId, "homework", this.deps.household().config.session_idle_minutes, buddyId);
    const turnId = db.insertTurn({ sessionId: session.id, role: "tutor", text });
    this.publish(childId, buddyId, session.id, turnId, { kind: "checkin", text }, created);
  }

  /** A reminder going off: the buddy's message in its chat, with no model call. */
  remind(childId: string, appId: string, schedule: Schedule) {
    const { db } = this.deps;
    const household = this.deps.household();
    const { session, created } = db.currentSession(childId, appId, household.config.session_idle_minutes, schedule.buddyId);
    const turnId = db.insertTurn({ sessionId: session.id, role: "tutor", text: `Reminder: ${schedule.text}` });
    this.publish(childId, schedule.buddyId, session.id, turnId, { kind: "reminder", scheduleId: schedule.id, label: schedule.label, text: schedule.text, task: schedule.kind === "task" }, created);
  }

  /** Save the child's message and show it in the chat. */
  private receive(childId: string, appId: string, rawText: string, buddyId: number | null, fileIds: number[], scheduled?: Schedule): Received {
    const { db } = this.deps;
    const household = this.deps.household();
    if (!household.children.has(childId) || !household.apps.has(appId)) throw new Error(`Unknown child or app: ${childId}/${appId}`);
    const text = rawText.trim().slice(0, 4000);
    const { session, created } = db.currentSession(childId, appId, household.config.session_idle_minutes, buddyId);
    // Files shared with a message reach the tutor in full (agent.ts loads them), and go to the classifier as text, so a
    // photographed question becomes the problem the leak check guards.
    const shared = (buddyId === null ? [] : db.listFiles(buddyId))
      .filter((f) => fileIds.includes(f.id) && f.status === "ready")
      .slice(0, FILE_LIMITS.perMessage)
      .map((f) => db.fileById(f.id)!)
      .filter((f) => f?.childId === childId);
    const turnId = db.insertTurn({
      sessionId: session.id,
      role: "child",
      text: scheduled ? `[Plan: ${scheduled.label}] ${text}` : shared.length ? `${text}\n[shared: ${shared.map((f) => f.name).join(", ")}]` : text,
    });
    const fileRefs = shared.map((f) => ({ id: f.id, name: f.name, kind: f.kind }));
    const item: ChatItem = scheduled
      ? { kind: "reminder", scheduleId: scheduled.id, label: scheduled.label, text, task: scheduled.kind === "task" }
      : { kind: "child", text, ...(fileRefs.length ? { files: fileRefs } : {}) };
    this.publish(childId, buddyId, session.id, turnId, item, created);
    if (created) this.emitFor(childId, buddyId, { type: "problem", problem: problemView(db.activeProblem(childId, buddyId)) }, appId);
    return { turnId, text, shared, ...(scheduled ? { scheduled } : {}) };
  }

  private async run(childId: string, appId: string, messages: Received[], buddyId: number | null): Promise<TurnResult> {
    const { db, classifier, tutor } = this.deps;
    const emit = (_childId: string, event: ServerEvent) => this.emitFor(childId, buddyId, event, appId);
    const household = this.deps.household();
    const child = household.children.get(childId);
    const found = household.apps.get(appId);
    // Only apps turned on for this child (the server checks before this too).
    const app = found && child && appOn(child, found) ? found : undefined;
    if (!child || !app) throw new Error(`Unknown child or app: ${childId}/${appId}`);
    const session = db.latestSession(childId, appId, buddyId)!;
    const text = messages.map((m) => m.text).join("\n").slice(0, 4000);
    const turnIds = messages.map((m) => m.turnId);
    const childTurnId = turnIds.at(-1)!;
    let shared = [...new Map(messages.flatMap((m) => m.shared).map((f) => [f.id, f])).values()].slice(0, FILE_LIMITS.perMessage);
    const buddyFiles = buddyId === null ? [] : db.listFiles(buddyId);
    const buddy = db.buddyById(buddyId);
    const persona = personaFor(buddy, child.profile.subjects);
    const buddySubject = buddy?.subject && child.profile.subjects.includes(buddy.subject) ? buddy.subject : null;
    // Every turn the buddy sees its file list and its memory notes, fenced as material with an id nothing inside can
    // guess (see fenceMaterial).
    const fenceId = newFenceId();
    const notes = buddyId === null ? null : (readMemory(household.dir, childId, buddyId)?.text ?? null);
    const scheduled = messages.find((m) => m.scheduled)?.scheduled;
    const buddySchedules = buddyId === null ? [] : (this.deps.schedules?.list(childId).filter((s) => s.buddyId === buddyId) ?? []);
    let material =
      [
        buildCatalogue(buddyFiles, fenceId),
        memoryBlock(notes, child.profile.name, fenceId),
        schedulesBlock(buddySchedules, fenceId),
        // In a studio, the buddy knows which pictures have been made in this chat, to talk about them.
        app?.kind === "studio" ? madePictures(db.transcript(session.id), fenceId) : null,
        scheduled
          ? scheduled.kind === "reminder"
            ? `It's ${scheduled.when.replace(/^.* at /, "")}: time for the reminder ${child.profile.name} asked you for earlier ("${scheduled.label}"). This message is that reminder. Remind them in your own words, warmly, in one or two short sentences, and offer to help if it fits.`
            : `It's ${scheduled.when.replace(/^.* at /, "")}: this message is the plan ${child.profile.name} set up with you earlier ("${scheduled.label}"). Start it now, warmly, as if picking up where you left off.`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n") || undefined;
    let sharedText = shared.map((f) => `${f.name}:\n${f.text}`).join("\n\n");

    const notice = (message: string): TurnResult => {
      const noticeTurnId = db.insertTurn({ sessionId: session.id, role: "tutor", text: message });
      this.publish(childId, buddyId, session.id, noticeTurnId, { kind: "notice", text: message });
      return { reply: message, intent: null, action: null, blocked: [], fallback: false, effects: [] };
    };
    const title = household.config.parent.title;
    if (!withinHours(child.rules)) return notice(`OpenBuddies is resting right now. Ask ${title} if you need help.`);
    if (db.usageToday(childId) >= allowanceFor(household, child)) {
      return notice(`You've done loads today! OpenBuddies is resting until tomorrow. Ask ${title} if you need more help.`);
    }

    emit(childId, { type: "thinking", on: true });
    let tokens = 0;
    try {
      // 1. Classify.
      let active = db.activeProblem(childId, buddyId);
      const recent = db
        .transcript(session.id)
        .filter((t) => t.role === "child" && !turnIds.includes(t.id))
        .slice(-4)
        .map((t) => t.text);
      // The buddy's files the message might mean go to the classifier as a list, so "check our history homework" finds
      // the file without the child sharing it. Files already shared aren't offered again.
      const canLookUp = !!this.deps.web?.available() && child.rules.web.mode !== "off" && db.lookupsToday(childId) < child.rules.web.daily_lookups;
      const candidates = fileCandidates(
        buddyFiles.filter((f) => f.status === "ready" && !shared.some((s) => s.id === f.id)),
        text,
      );
      const classified = await classifier.classify(sharedText ? `${text}\n\nShared with this message:\n${sharedText}`.slice(0, 4000) : text, {
        activeProblem: active?.text ?? null,
        activeSubject: active?.subject ?? null,
        subjects: child.profile.subjects,
        buddySubject,
        recent,
        ...(candidates.length ? { files: candidates } : {}),
        // Only ask for a search query when this child can have things looked up today.
        ...(canLookUp ? { web: true } : {}),
      });
      tokens += classified.tokens;
      // A reminder or plan going off is the child's earlier request being carried out: never a new request to schedule
      // something, and never off topic.
      const intent =
        scheduled && ["schedule", "off_topic", "chat"].includes(classified.intent.intent) ? { ...classified.intent, intent: "general" as const } : classified.intent;
      if (classified.error) this.deps.log?.(`classifier error for ${childId}: ${classified.error}`);

      // Files the child mentioned: shared with the buddy for this reply as if they'd used the paperclip, so the leak
      // check guards them too. Only this buddy's own, ready files.
      const found = (intent.files ?? [])
        .map((id) => db.fileById(id))
        .filter((f): f is FileRow => !!f && f.childId === childId && f.buddyId === buddyId && f.status === "ready" && !shared.some((s) => s.id === f.id))
        .slice(0, Math.max(0, FILE_LIMITS.perMessage - shared.length));
      if (found.length) {
        shared = [...shared, ...found];
        sharedText = shared.map((f) => `${f.name}:\n${f.text}`).join("\n\n");
        this.publish(childId, buddyId, session.id, childTurnId, { kind: "files_used", files: found.map((f) => ({ id: f.id, name: f.name, kind: f.kind })) });
      }

      // Something to look up on the internet: the facts go to the buddy as material, the sources to the chat.
      if (intent.lookup && canLookUp && this.deps.web && intent.welfare !== "concerning") {
        db.addLookup(childId);
        const looked = await this.deps.web.lookUp(child, text, intent.lookup).catch((e) => {
          this.deps.log?.(`web lookup failed for ${childId}: ${(e as Error).message}`);
          return null;
        });
        if (looked) {
          tokens += looked.tokens;
          const block = lookupBlock(looked, fenceId);
          if (block) {
            material = [material, block].filter(Boolean).join("\n\n");
            this.publish(childId, buddyId, session.id, childTurnId, { kind: "looked_up", sources: looked.sources });
          }
        }
      }

      // 2. Welfare alert is raised before any reply is generated.
      if (intent.welfare !== "fine") {
        const sensitivity = child.rules.alerts.welfare.sensitivity;
        if (intent.welfare === "concerning" || sensitivity === "high") {
          db.insertAlert({ childId, turnId: childTurnId, ...welfareSummary(child.profile.name, intent.welfare, app.name) });
        }
      }

      // 3. Ladder state: a different problem starts a new ladder.
      let isNewProblem = false;
      const tutoring = intent.intent !== "off_topic" && intent.intent !== "chat" && intent.intent !== "general" && intent.welfare !== "concerning";
      const switching = active && intent.intent !== "check_my_work" && intent.problem && !sameProblem(intent.problem, active.text);
      if (tutoring && intent.problem && (!active || switching)) {
        active = db.createProblem({ sessionId: session.id, childId, buddyId, subject: intent.subject, label: labelFor(intent.problem), text: intent.problem });
        isNewProblem = true;
        emit(childId, { type: "problem", problem: problemView(active) });
      }
      const state: LadderState = {
        problem: active ? { rung: active.rung, attempts: active.attempts, correct: !!active.correct, subject: active.subject } : null,
        isNewProblem,
      };

      // 4. Decide. Pure.
      const action = decide(intent, state, child.rules, app);
      for (const id of turnIds) db.sql.prepare("UPDATE turns SET intent_json = ?, action_json = ? WHERE id = ?").run(JSON.stringify(intent), JSON.stringify(action), id);

      // Picture Studio: if the child asked for a picture (or a change to the last one), draw it instead of a reply.
      if (app.kind === "studio" && this.deps.pictures?.available() && action.kind !== "welfare_response" && action.kind !== "schedule") {
        const studio = await this.studioTurn(childId, buddyId, appId, session.id, child, action);
        tokens += studio.tokens;
        if (studio.done) return { reply: studio.done, intent, action, blocked: [], fallback: false, effects: [] };
      }

      // A quiz: worked out (and the style asked if they didn't say), then made in the background.
      if (action.kind === "quiz") {
        const res =
          buddyId !== null && this.deps.quizzes
            ? await this.deps.quizzes.request(childId, buddyId, appId, db.transcript(session.id).map((t) => ({ role: t.role, text: t.text })))
            : { reply: "I can't make quizzes here, sorry!", offer: null, tokens: 0 };
        tokens += res.tokens;
        const tutorTurnId = db.insertTurn({ sessionId: session.id, role: "tutor", text: res.reply, action });
        this.publish(childId, buddyId, session.id, tutorTurnId, { kind: "tutor", text: res.reply });
        if (res.offer) this.publish(childId, buddyId, session.id, tutorTurnId, { kind: "quiz_offer", quizId: res.offer.quizId, topic: res.offer.topic });
        return { reply: res.reply, intent, action, blocked: [], fallback: false, effects: [] };
      }

      // A reminder or plan: worked out and offered for the child to confirm, instead of a tutor reply.
      if (action.kind === "schedule") {
        const proposal =
          buddyId !== null && this.deps.schedules
            ? await this.deps.schedules.propose(childId, buddyId, text)
            : { schedule: null, reply: "I can't set reminders here, sorry!", tokens: 0 };
        tokens += proposal.tokens;
        const tutorTurnId = db.insertTurn({ sessionId: session.id, role: "tutor", text: proposal.reply, action });
        this.publish(childId, buddyId, session.id, tutorTurnId, { kind: "tutor", text: proposal.reply });
        const p = proposal.schedule;
        if (p) this.publish(childId, buddyId, session.id, tutorTurnId, { kind: "schedule", scheduleId: p.id, label: p.label, when: p.when, task: p.kind === "task" });
        return { reply: proposal.reply, intent, action, blocked: [], fallback: false, effects: [] };
      }

      // 5. Generate, then leak-check. Blocked drafts are rolled back out of the model's history.
      const replyId = `r${childTurnId}`;
      const guardProblem = active ? { label: active.label, text: active.text, correct: !!active.correct } : null;
      const flags: { severity: string; summary: string }[] = [];
      const respond = (a: Action) =>
        tutor.respond({
          child,
          app,
          sitting: { id: session.id, piSessionId: session.pi_session_id },
          persona,
          text,
          buddyId,
          files: shared.map((f) => ({ id: f.id, name: f.name })),
          material,
          action: a,
          problem: guardProblem,
          onDelta: a.enforce ? undefined : (d) => emit(childId, { type: "reply_delta", id: replyId, text: d }),
          onFlag: (severity, summary) => flags.push({ severity, summary }),
        });

      const blocked: { draft: Draft; reason: string }[] = [];
      let draft: Draft | null = await respond(action);
      tokens += draft.tokens;
      if (!session.pi_session_id || session.pi_session_id !== draft.piSessionId) db.setPiSessionId(session.id, draft.piSessionId);
      // What the leak check guards: the homework problem. A message that asks for an answer but names no problem is
      // guarded as its own problem; a general question with no problem around has nothing to give away.
      const guarded = active?.text ?? intent.problem ?? (sharedText || (HOMEWORK_INTENTS.has(intent.intent) ? text : null));
      while (action.enforce && guarded && draft) {
        const verdict = await classifier.leakCheck(guarded, draft.visibleText, text);
        tokens += verdict.tokens;
        if (!verdict.gives_answer) break;
        blocked.push({ draft, reason: verdict.reason });
        await draft.rollback();
        if (blocked.length >= child.rules.max_leak_retries) {
          draft = null;
          break;
        }
        draft = await respond({ ...action, avoid: draft.visibleText });
        tokens += draft.tokens;
      }

      // 6. Raise any flag_for_parent alerts (these fire even from a blocked draft).
      for (const f of flags) {
        const severity = f.severity === "high" ? "high" : f.severity === "low" ? "low" : "medium";
        db.insertAlert({ childId, turnId: childTurnId, severity, summary: f.summary });
      }

      // 7. Commit the approved draft's effects and deliver it.
      const fallback = draft === null;
      const effects = draft?.effects ?? [];
      const replyText = fallback ? SAFE_FALLBACK : draft!.text || (effects.some((e) => e.type !== "set_problem" && e.type !== "flag") ? "" : SAFE_FALLBACK);
      const tutorTurnId = db.insertTurn({ sessionId: session.id, role: "tutor", text: fallback ? SAFE_FALLBACK : draft!.visibleText || replyText, action });

      for (const b of blocked) {
        db.insertBlockedDraft(tutorTurnId, b.draft.visibleText, b.reason);
        for (const c of b.draft.calls) db.insertToolCall(tutorTurnId, c.tool, c.args, false, c.accepted ? "not applied: draft blocked by leak check" : c.error);
      }
      for (const c of draft?.calls ?? []) db.insertToolCall(tutorTurnId, c.tool, c.args, c.accepted, c.error);

      let problem = active;
      let solved = false;
      for (const e of effects) {
        switch (e.type) {
          case "set_problem":
            if (problem && sameProblem(problem.text, e.text)) {
              db.updateProblem(problem.id, { label: e.label, text: e.text });
            } else {
              problem = db.createProblem({ sessionId: session.id, childId, buddyId, subject: intent.subject, label: e.label, text: e.text });
            }
            problem = db.problem(problem.id);
            emit(childId, { type: "problem", problem: problemView(problem) });
            break;
          case "hint":
            this.publish(childId, buddyId, session.id, tutorTurnId, { kind: "hint", rung: e.rung, text: e.text });
            break;
          case "worked_example":
            this.publish(childId, buddyId, session.id, tutorTurnId, { kind: "worked_example", problem: e.problem, steps: e.steps });
            break;
          case "check":
            if (problem) {
              db.updateProblem(problem.id, { attempts: problem.attempts + 1, correct: problem.correct || e.correct ? 1 : 0 });
              problem = db.problem(problem.id);
            }
            this.publish(childId, buddyId, session.id, tutorTurnId, { kind: "check", answer: e.answer, correct: e.correct, feedback: e.feedback });
            break;
          case "solved":
            if (problem) db.updateProblem(problem.id, { solved_at: new Date().toISOString() });
            solved = true;
            this.publish(childId, buddyId, session.id, tutorTurnId, { kind: "solved", label: e.label });
            break;
          case "flag":
            break;
        }
      }
      if (problem && !solved) {
        const rung = advance(problem.rung, action);
        if (rung !== problem.rung) db.updateProblem(problem.id, { rung });
      }

      if (replyText) {
        if (action.enforce || fallback) await this.streamText(childId, buddyId, appId, replyId, replyText);
        else emit(childId, { type: "reply_end", id: replyId });
        this.publish(childId, buddyId, session.id, tutorTurnId, { kind: "tutor", text: replyText });
      }
      emit(childId, { type: "problem", problem: solved ? null : problemView(problem ? db.problem(problem.id) : null) });

      // "Remember that…" gets the notes updated straight away, so what the buddy said it would keep is kept.
      if (buddyId !== null) void (ASKS_TO_REMEMBER.test(text) ? this.deps.memory?.updateNow(childId, buddyId) : this.deps.memory?.afterTurn(childId, buddyId));
      return { reply: replyText, intent, action, blocked: blocked.map((b) => ({ text: b.draft.visibleText, reason: b.reason })), fallback, effects };
    } catch (e) {
      this.deps.log?.(`turn failed for ${childId}: ${(e as Error).message}`);
      emit(childId, { type: "error", message: "Sorry, I couldn't think just now. Try sending that again in a moment." });
      throw e;
    } finally {
      db.addUsage(childId, tokens);
      emit(childId, { type: "thinking", on: false });
    }
  }
}
