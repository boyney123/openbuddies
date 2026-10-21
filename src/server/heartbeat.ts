// The buddies' daily check-in, like OpenClaw's heartbeat: once a day, at a time the parent can set (16:30 by default),
// OpenBuddies asks whether one of a child's buddies has a good reason to say something: a test tomorrow, practice they
// planned. Usually not, and nothing is sent. When there is, the buddy's message lands in its chat and as a
// notification. It never runs outside the child's allowed hours, when the allowance is used up, or if they're already
// chatting; it costs a model call only when a buddy has notes or reminders to go on.

import type { StructuredCaller } from "./classifier.js";
import { allowanceFor, withinHours, type Child, type Household } from "./config.js";
import type { Db } from "./db.js";
import { readMemory } from "./memory.js";
import { fenceMaterial, HEARTBEAT_SCHEMA, HEARTBEAT_SYSTEM, newFenceId, sanitiseChildText } from "./prompts.js";
import type { Scheduler } from "./schedules.js";

/** Too late to check in once this long after the set time (the server was off, say). */
const LATE_MS = 3 * 3_600_000;
/** Chatting this recently means no check-in today. */
const RECENT_MS = 2 * 3_600_000;

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface HeartbeatDeps {
  db: Db;
  household: () => Household;
  model: StructuredCaller;
  schedules: Pick<Scheduler, "list">;
  /** The buddy's message in its chat. */
  deliver: (childId: string, buddyId: number, text: string) => void;
  notify: (childId: string, n: { title: string; body: string; url: string }) => Promise<void>;
  log?: (msg: string) => void;
}

export class Heartbeat {
  private running = false;

  constructor(private deps: HeartbeatDeps) {}

  /** Check every child whose time has come today. Run every minute; `now` is for tests. */
  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const child of this.deps.household().children.values()) {
        await this.checkIn(child, now).catch((e) => this.deps.log?.(`check-in failed for ${child.profile.id}: ${(e as Error).message}`));
      }
    } finally {
      this.running = false;
    }
  }

  private async checkIn(child: Child, now: Date) {
    const { db } = this.deps;
    const id = child.profile.id;
    const day = localDay(now);
    const { mode, at } = child.rules.heartbeat;
    if (mode === "off" || db.heartbeatRan(id, day)) return;
    const [hh, mm] = at.split(":").map(Number);
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm);
    if (now < due) return;
    const skip = (why: string) => db.recordHeartbeat(id, day, why);
    if (now.getTime() - due.getTime() > LATE_MS) return skip("too late");
    if (!withinHours(child.rules, now)) return skip("outside allowed hours");
    if (db.usageToday(id) >= allowanceFor(this.deps.household(), child)) return skip("allowance used up");
    const last = db.lastChildMessageAt(id);
    if (last && now.getTime() - Date.parse(last) < RECENT_MS) return skip("chatting already");

    // What each buddy has to go on. Nothing anywhere: no model call.
    const home = this.deps.household().dir;
    const schedules = this.deps.schedules.list(id).filter((s) => s.status === "active");
    const buddies = db
      .listBuddies(id)
      .map((b) => ({ b, notes: readMemory(home, id, b.id)?.text ?? null, reminders: schedules.filter((s) => s.buddyId === b.id) }))
      .filter((x) => x.notes || x.reminders.length);
    if (!buddies.length) return skip("nothing to go on");

    const fence = newFenceId();
    const today = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const res = await this.deps.model.completeStructured<{ notify?: boolean; buddy_id?: number | null; message?: string }>({
      system: HEARTBEAT_SYSTEM,
      user: [
        `Today is ${today}, ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}. The child is ${child.profile.name}, ${child.profile.age}.`,
        ...buddies.map(({ b, notes, reminders }) =>
          fenceMaterial(fence, `Buddy id ${b.id}, "${b.name}"`, [notes ? `Notes:\n${notes}` : "", reminders.length ? `Reminders:\n${reminders.map((r) => `- ${r.when}: ${r.label}`).join("\n")}` : ""].filter(Boolean).join("\n\n")),
        ),
      ].join("\n\n"),
      toolName: "check_in",
      description: "Record whether to check in, and the message",
      schema: HEARTBEAT_SCHEMA,
      model: "check",
      maxTokens: 300,
    });
    db.addUsage(id, res.tokens);
    const pick = buddies.find((x) => x.b.id === res.value?.buddy_id)?.b;
    const text = typeof res.value?.message === "string" ? sanitiseChildText(res.value.message).replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 240) : "";
    if (!res.value?.notify || !pick || !text) return skip(res.value ? "nothing to say" : "check failed");

    this.deps.deliver(id, pick.id, text);
    db.recordHeartbeat(id, day, "checked in", pick.id);
    await this.deps.notify(id, { title: pick.name, body: text, url: "/#app-homework" });
    this.deps.log?.(`${pick.name} checked in with ${id}`);
  }

  /** Every minute. Returns a function that stops it. */
  start(): () => void {
    const timer = setInterval(() => void this.tick(), 60_000);
    timer.unref();
    return () => clearInterval(timer);
  }
}
