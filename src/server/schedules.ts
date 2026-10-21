// Reminders and plans a child sets up with a buddy: "remind me tomorrow at 8 to pack my PE kit", "every weekday at 4
// quiz me on times tables". The same shape as OpenClaw's automations: the scheduler lives in the server (not the
// model), jobs are stored in SQLite so restarts don't lose them, a one-off is done once it has run, and runs missed
// while the server was off are skipped rather than replayed.
//
// The child asks in the chat; the classifier labels it `schedule`, the check model turns it into a rule
// (proposeSchedule), and the chat shows a card the child taps to confirm, so nothing is set up without them seeing it.
// When one goes off it lands in the buddy's chat (and as a notification, see push.ts): a reminder is a fixed message
// with no model call; a task runs a buddy turn through the full pipeline, so it can't hand out answers. Schedules only
// go off within the child's allowed hours, tasks count against their daily allowance, and the parent sees and can
// pause or delete every one.

import { SCHEDULE_LIMITS, type Schedule, type ScheduleRule, type ScheduleStatus } from "../shared/protocol.js";
import type { StructuredCaller } from "./classifier.js";
import { allowanceFor, withinHours, type Child, type Household } from "./config.js";
import type { Db } from "./db.js";
import { fenceMaterial, SCHEDULE_SCHEMA, SCHEDULE_SYSTEM, sanitiseChildText } from "./prompts.js";

// ---- rules and time ----

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** How far ahead a one-off can be. */
const MAX_AHEAD_DAYS = 366;
/** A run more than this late (the server was off or asleep) is skipped, not replayed. */
export const MISSED_AFTER_MS = 15 * 60_000;
/** A proposal the child never confirmed is dropped after this long. */
const PROPOSAL_TTL_MS = 24 * 3_600_000;

const atLocal = (date: string, time: string): Date => {
  const [, y, m, d] = DATE.exec(date)!.map(Number);
  const [, hh, mm] = TIME.exec(time)!.map(Number);
  return new Date(y, m - 1, d, hh, mm);
};

/** A rule as it can be trusted: a real date and time, and real weekdays. Null if it isn't one. */
export function checkRule(raw: unknown): ScheduleRule | null {
  const r = raw as Partial<Record<string, unknown>> | null;
  if (!r || typeof r.time !== "string" || !TIME.test(r.time)) return null;
  if (r.repeat === "once") {
    if (typeof r.date !== "string" || !DATE.test(r.date)) return null;
    const at = atLocal(r.date, r.time);
    // Rejects dates like 2026-02-31, which Date would roll over.
    const [, y, m, d] = DATE.exec(r.date)!.map(Number);
    if (at.getFullYear() !== y || at.getMonth() !== m - 1 || at.getDate() !== d) return null;
    return { repeat: "once", date: r.date, time: r.time };
  }
  if (r.repeat === "weekly") {
    const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
    return days.length ? { repeat: "weekly", days, time: r.time } : null;
  }
  return null;
}

/** When the rule next goes off after `after`, or null if it never will again. */
export function nextRun(rule: ScheduleRule, after: Date): Date | null {
  if (rule.repeat === "once") {
    const at = atLocal(rule.date, rule.time);
    return at > after ? at : null;
  }
  const [hh, mm] = rule.time.split(":").map(Number);
  for (let i = 0; i <= 7; i++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + i, hh, mm);
    if (rule.days.includes(day.getDay()) && day > after) return day;
  }
  return null;
}

export function fmtClock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/** The rule in words: "Weekdays at 4:00pm", "Mon and Wed at 5:30pm", "Thu 23 Oct at 8:00am". */
export function describeRule(rule: ScheduleRule): string {
  const at = `at ${fmtClock(rule.time)}`;
  if (rule.repeat === "once") {
    return `${atLocal(rule.date, rule.time).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${at}`;
  }
  const d = rule.days.join(",");
  const days =
    d === "0,1,2,3,4,5,6" ? "Every day" : d === "1,2,3,4,5" ? "Weekdays" : d === "0,6" ? "Weekends" : rule.days.length === 1 ? `Every ${DAY_NAMES[rule.days[0]]}` : listWords(rule.days.map((x) => DAY_NAMES[x]));
  return `${days} ${at}`;
}

const listWords = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Plain text a child wrote, made safe to store and show: no markup, one line, not too long. */
function cleanText(raw: unknown, max: number): string {
  return typeof raw === "string" ? sanitiseChildText(raw).replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

// ---- turning a request into a proposal ----

export interface ScheduleDraft {
  kind: "reminder" | "task";
  label: string;
  text: string;
  rule: ScheduleRule;
}

/**
 * Check what the model made of the request, in code: a real rule that goes off again, not too far ahead, within the
 * child's allowed hours. Returns the draft, or what the buddy should say instead.
 */
export function checkDraft(raw: any, rules: Child["rules"], now: Date): { draft: ScheduleDraft } | { reply: string } {
  if (!raw || raw.understood === false) return { reply: cleanText(raw?.question, 200) || "I can set that up! What day and time should it be?" };
  const rule = checkRule({
    repeat: raw.repeat,
    date: raw.date,
    time: raw.time,
    days: Array.isArray(raw.days) ? raw.days.map((d: unknown) => DAY_KEYS.indexOf(String(d))) : [],
  });
  const label = cleanText(raw.label, SCHEDULE_LIMITS.labelLength);
  const text = cleanText(raw.text, SCHEDULE_LIMITS.textLength);
  if (!rule || !label || !text) return { reply: "I didn't quite catch when. Can you tell me the day and time?" };
  const next = nextRun(rule, now);
  if (!next) return { reply: "That time has already gone! When should it be instead?" };
  if (rule.repeat === "once" && next.getTime() - now.getTime() > MAX_AHEAD_DAYS * 86_400_000) return { reply: "That's a long way off! Can we pick something within the next year?" };
  if (!withinHours(rules, next)) return { reply: "I'm resting at that time, so I couldn't remind you then. Can we pick another time?" };
  return { draft: { kind: raw.kind === "task" ? "task" : "reminder", label, text, rule } };
}

/** Ask the check model what the child wants set up. The request is the child's words: quoted, never instructions. */
export async function proposeSchedule(
  caller: StructuredCaller,
  text: string,
  rules: Child["rules"],
  now = new Date(),
): Promise<{ draft: ScheduleDraft | null; reply: string; tokens: number }> {
  const today = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const isoToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const res = await caller.completeStructured<any>({
    system: SCHEDULE_SYSTEM,
    user: `It is ${today} (${isoToday}), ${clock}.\n\nThe child's request:\n"""\n${sanitiseChildText(text).slice(0, 1000)}\n"""`,
    toolName: "schedule_request",
    description: "Record the reminder or plan",
    schema: SCHEDULE_SCHEMA,
    model: "check",
    maxTokens: 400,
  });
  if (!res.value) return { draft: null, reply: "Sorry, I couldn't set that up just now. Can you ask me again?", tokens: res.tokens };
  const checked = checkDraft(res.value, rules, now);
  if ("reply" in checked) return { draft: null, reply: checked.reply, tokens: res.tokens };
  const d = checked.draft;
  const reply = d.kind === "task" ? `I can do that! Tap "Set it" and I'll be ready ${describeRule(d.rule).replace(/^Every day/, "every day").replace(/^(Weekdays|Weekends)/, (w) => `on ${w.toLowerCase()}`)}.` : `Good idea! Tap "Set it" and I'll remind you.`;
  return { draft: d, reply, tokens: res.tokens };
}

/** The buddy's schedules, for the tutor to know about each turn. Null when there are none. */
export function schedulesBlock(schedules: Schedule[], fenceId: string): string | null {
  const live = schedules.filter((s) => s.status === "active" || s.status === "paused");
  if (!live.length) return null;
  const lines = live.map((s) => `- ${s.when}: ${s.label} (${s.kind === "task" ? `you'll ${s.text}` : `reminder: ${s.text}`})${s.status === "paused" ? " [paused]" : ""}`);
  return fenceMaterial(
    fenceId,
    "Reminders and plans the child has set up with you. They're set up and changed by tapping in the app, not by you; if they want a new one, they can just ask.",
    lines.join("\n"),
  );
}

// ---- the scheduler ----

export interface SchedulerDeps {
  db: Db;
  household: () => Household;
  model: StructuredCaller;
  /**
   * A schedule going off in the buddy's chat: the buddy responds to it (a model turn), or, with `useModel` false (the
   * allowance is used up), the reminder appears as it is. Returns what the buddy said.
   */
  deliver: (childId: string, schedule: Schedule, useModel: boolean) => Promise<string>;
  /** A notification on the child's devices that allow them. */
  notify: (childId: string, n: { title: string; body: string; url: string }) => Promise<void>;
  emit: (childId: string, schedules: Schedule[]) => void;
  log?: (msg: string) => void;
}

export class Scheduler {
  private ticking = false;

  constructor(private deps: SchedulerDeps) {}

  list(childId: string): Schedule[] {
    return this.deps.db.listSchedules(childId).filter((s) => s.status !== "cancelled" && s.status !== "done");
  }

  private changed(childId: string) {
    this.deps.emit(childId, this.list(childId));
  }

  /** The child asked for a reminder or plan: work out what, and store it as a proposal for them to confirm. */
  async propose(childId: string, buddyId: number, text: string, now = new Date()): Promise<{ schedule: Schedule | null; reply: string; tokens: number }> {
    const { db } = this.deps;
    const child = this.deps.household().children.get(childId);
    if (!child) return { schedule: null, reply: "Sorry, I couldn't set that up.", tokens: 0 };
    if (this.list(childId).filter((s) => s.status !== "proposed").length >= SCHEDULE_LIMITS.perChild) {
      return { schedule: null, reply: `You've already got ${SCHEDULE_LIMITS.perChild} reminders! Delete one on the home screen and I can add this.`, tokens: 0 };
    }
    const res = await proposeSchedule(this.deps.model, text, child.rules, now);
    if (!res.draft) return { schedule: null, reply: res.reply, tokens: res.tokens };
    const id = db.addSchedule({ childId, buddyId, ...res.draft });
    this.changed(childId);
    return { schedule: db.scheduleById(id), reply: res.reply, tokens: res.tokens };
  }

  /** A reminder the child made on the Reminders page: checked like any other, and on straight away. */
  add(childId: string, buddyId: number, raw: { kind?: unknown; text?: unknown; rule?: unknown }, now = new Date()): { schedule: Schedule } | { error: string } {
    const { db } = this.deps;
    const child = this.deps.household().children.get(childId);
    if (!child) return { error: "Couldn't set that up." };
    if (this.list(childId).filter((s) => s.status !== "proposed").length >= SCHEDULE_LIMITS.perChild) return { error: `You've already got ${SCHEDULE_LIMITS.perChild} reminders. Delete one to add another.` };
    const rule = checkRule(raw.rule);
    const text = cleanText(raw.text, SCHEDULE_LIMITS.textLength);
    if (!text) return { error: "Say what the reminder is for." };
    if (!rule) return { error: "Pick a day and time." };
    const next = nextRun(rule, now);
    if (!next) return { error: "That time has already gone. Pick a later one." };
    if (rule.repeat === "once" && next.getTime() - now.getTime() > MAX_AHEAD_DAYS * 86_400_000) return { error: "Pick a time within the next year." };
    if (!withinHours(child.rules, next)) return { error: "OpenBuddies is resting at that time. Pick another." };
    const id = db.addSchedule({ childId, buddyId, kind: raw.kind === "task" ? "task" : "reminder", label: text.slice(0, SCHEDULE_LIMITS.labelLength), text, rule });
    db.setScheduleStatus(id, "active", next.toISOString());
    this.changed(childId);
    return { schedule: db.scheduleById(id)! };
  }

  /** The child (or parent) confirms, turns down, pauses, resumes or deletes a schedule. False if it can't. */
  act(childId: string, id: number, action: "confirm" | "cancel" | "pause" | "resume" | "delete", now = new Date()): boolean {
    const { db } = this.deps;
    const s = db.scheduleById(id);
    if (!s || db.scheduleChild(id) !== childId) return false;
    const allowed: Record<typeof action, ScheduleStatus[]> = {
      confirm: ["proposed"],
      cancel: ["proposed"],
      pause: ["active"],
      resume: ["paused"],
      delete: ["proposed", "active", "paused"],
    };
    if (!allowed[action].includes(s.status)) return false;
    if (action === "confirm" || action === "resume") {
      const next = nextRun(s.rule, now);
      if (!next) {
        db.setScheduleStatus(id, "done", null);
        this.changed(childId);
        return false;
      }
      db.setScheduleStatus(id, "active", next.toISOString());
    } else {
      db.setScheduleStatus(id, action === "pause" ? "paused" : "cancelled", s.nextAt);
    }
    this.changed(childId);
    return true;
  }

  /** Go off whatever is due. Run every half minute; `now` is for tests. */
  async tick(now = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const { db } = this.deps;
      const touched = new Set<string>();
      for (const childId of db.expireProposals(new Date(now.getTime() - PROPOSAL_TTL_MS).toISOString())) touched.add(childId);
      for (const { childId, schedule } of db.dueSchedules(now.toISOString())) {
        touched.add(childId);
        await this.run(childId, schedule, now).catch((e) => this.deps.log?.(`schedule ${schedule.id} failed: ${(e as Error).message}`));
      }
      for (const childId of touched) this.changed(childId);
    } finally {
      this.ticking = false;
    }
  }

  private async run(childId: string, s: Schedule, now: Date) {
    const { db } = this.deps;
    const household = this.deps.household();
    const child = household.children.get(childId);
    const buddy = db.buddyById(s.buddyId);
    const finish = (result: string) => {
      const next = s.rule.repeat === "weekly" ? nextRun(s.rule, new Date(now.getTime() + 60_000)) : null;
      db.recordScheduleRun(s.id, now.toISOString(), result, next ? "active" : "done", next?.toISOString() ?? null);
    };
    if (!child || !buddy || buddy.deleted) return db.setScheduleStatus(s.id, "cancelled", null);
    // Late by more than a few minutes: the server was off or asleep. Skip it rather than go off at the wrong time.
    if (now.getTime() - Date.parse(s.nextAt!) > MISSED_AFTER_MS) return finish("missed");
    if (!withinHours(child.rules, now)) return finish("outside allowed hours");

    // The buddy responds in its own words; with the allowance used up, the reminder goes off as it is.
    const useModel = db.usageToday(childId) < allowanceFor(household, child);
    const said = await this.deps.deliver(childId, s, useModel);
    finish(useModel ? "buddy responded" : "reminded (allowance used up)");

    await this.deps.notify(childId, { title: buddy.name, body: said, url: "/#homework" });
    this.deps.log?.(`schedule ${s.id} for ${childId} went off`);
  }

  /** Check every 30 seconds. Returns a function that stops it. */
  start(): () => void {
    void this.tick();
    const timer = setInterval(() => void this.tick(), 30_000);
    timer.unref();
    return () => clearInterval(timer);
  }
}
