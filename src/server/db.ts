import Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cleanWear, isBuddyColor, MAX_BUDDIES, type Accessory, type Buddy, type BuddyColor, type BuddyFile, type ChatItem, type FileKind, type ParentAlert, type ParentDevice, type ParentSessionProblem, type ParentSessionSummary, type ParentStats, type ParentTurn, type Nudge, type QuizStyle, type QuizSummary, type Schedule, type ScheduleRule, type ScheduleStatus, type Rung, type SequencedItem } from "../shared/protocol.js";
import { packageRoot } from "./paths.js";
import { describeRule } from "./schedules.js";

export interface ProblemRow {
  id: number;
  session_id: number;
  child_id: string;
  subject: string | null;
  label: string;
  text: string;
  rung: Rung;
  attempts: number;
  correct: number;
  solved_at: string | null;
}

export interface SessionRow {
  id: number;
  child_id: string;
  app: string;
  pi_session_id: string | null;
  buddy_id: number | null;
  started_at: string;
}

export interface QuizRow {
  id: number;
  childId: string;
  buddyId: number;
  app: string;
  topic: string;
  style: QuizStyle | null;
  count: number;
  status: "offered" | "making" | "ready" | "failed";
  title: string | null;
  questions: import("./quizzes.js").QuizQuestion[];
}

export interface FileRow extends BuddyFile {
  childId: string;
  mime: string;
  /** Relative to the household folder. */
  path: string;
  text: string | null;
}

/** A buddy that has passed validation (see buddies.ts). */
export interface BuddyFields {
  name: string;
  color: Buddy["color"];
  description: string;
  subject: string | null;
  /** Left out when changing a buddy: it keeps what it's wearing. */
  wear?: Accessory[];
}

export interface DeviceRow {
  id: number;
  child_id: string;
  name: string;
  revoked_at: string | null;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
const now = () => new Date().toISOString();
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
const parse = (s: string | null) => (s ? JSON.parse(s) : null);

export class Db {
  readonly sql: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sql = new Database(path);
    this.sql.pragma("journal_mode = WAL");
    this.sql.pragma("foreign_keys = ON");
    this.sql.pragma("busy_timeout = 5000");
    this.migrate();
  }

  private migrate() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const applied = new Set(this.sql.prepare("SELECT version FROM schema_migrations").pluck().all() as number[]);
    const dir = join(packageRoot(), "migrations");
    for (const file of readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
      const version = parseInt(file, 10);
      if (applied.has(version)) continue;
      this.sql.transaction(() => {
        this.sql.exec(readFileSync(join(dir, file), "utf8"));
        this.sql.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, now());
      })();
    }
  }

  close() {
    this.sql.close();
  }

  syncChildren(children: { id: string; name: string }[]) {
    const up = this.sql.prepare("INSERT INTO children (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name");
    for (const c of children) up.run(c.id, c.name);
  }

  // ---- buddies ----

  private toBuddy(r: any): Buddy {
    return { id: r.id, name: r.name, color: isBuddyColor(r.color) ? r.color : "blue", description: r.description, subject: r.subject, main: !!r.main, wear: cleanWear(JSON.parse(r.wear)) };
  }

  /** The child's buddies, main first. */
  listBuddies(childId: string): Buddy[] {
    return (this.sql.prepare("SELECT * FROM buddies WHERE child_id = ? AND deleted_at IS NULL ORDER BY main DESC, id").all(childId) as any[]).map((r) => this.toBuddy(r));
  }

  /** A buddy by id, including removed ones (for history). */
  buddyById(id: number | null): (Buddy & { childId: string; deleted: boolean }) | null {
    if (id === null) return null;
    const r = this.sql.prepare("SELECT * FROM buddies WHERE id = ?").get(id) as any;
    return r ? { ...this.toBuddy(r), childId: r.child_id, deleted: !!r.deleted_at } : null;
  }

  /** The buddy the child is talking to: the one they last picked, else their main buddy. */
  activeBuddyId(childId: string): number | null {
    return (
      (this.sql
        .prepare(
          `SELECT b.id FROM buddies b WHERE b.child_id = ? AND b.deleted_at IS NULL
           ORDER BY b.id = (SELECT active_buddy_id FROM children WHERE id = ?) DESC, b.main DESC, b.id LIMIT 1`,
        )
        .pluck()
        .get(childId, childId) as number | undefined) ?? null
    );
  }

  /** Make a buddy and switch to it. The first one becomes the main buddy. */
  createBuddy(childId: string, b: BuddyFields): Buddy {
    return this.sql.transaction(() => {
      const count = this.sql.prepare("SELECT COUNT(*) FROM buddies WHERE child_id = ? AND deleted_at IS NULL").pluck().get(childId) as number;
      if (count >= MAX_BUDDIES) throw new Error(`You can have up to ${MAX_BUDDIES} buddies. Remove one to make a new one.`);
      const info = this.sql
        .prepare("INSERT INTO buddies (child_id, name, color, description, subject, main, wear) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(childId, b.name, b.color, b.description, b.subject, count === 0 ? 1 : 0, JSON.stringify(b.wear ?? []));
      const id = Number(info.lastInsertRowid);
      this.sql.prepare("UPDATE children SET active_buddy_id = ? WHERE id = ?").run(id, childId);
      return this.buddyById(id)!;
    })();
  }

  updateBuddy(childId: string, id: number, b: BuddyFields): boolean {
    const info = this.sql
      .prepare("UPDATE buddies SET name = ?, color = ?, description = ?, subject = ?, wear = COALESCE(?, wear) WHERE id = ? AND child_id = ? AND deleted_at IS NULL")
      .run(b.name, b.color, b.description, b.subject, b.wear ? JSON.stringify(b.wear) : null, id, childId);
    return info.changes > 0;
  }

  dressBuddy(childId: string, id: number, color: BuddyColor, wear: Accessory[]): boolean {
    const info = this.sql.prepare("UPDATE buddies SET color = ?, wear = ? WHERE id = ? AND child_id = ? AND deleted_at IS NULL").run(color, JSON.stringify(wear), id, childId);
    return info.changes > 0;
  }

  /** Remove a buddy. The main buddy can't be removed. Its chats stay in the parent's history. */
  deleteBuddy(childId: string, id: number): boolean {
    const info = this.sql.prepare("UPDATE buddies SET deleted_at = ? WHERE id = ? AND child_id = ? AND main = 0 AND deleted_at IS NULL").run(now(), id, childId);
    return info.changes > 0;
  }

  switchBuddy(childId: string, id: number): boolean {
    const ok = this.sql.prepare("SELECT 1 FROM buddies WHERE id = ? AND child_id = ? AND deleted_at IS NULL").get(id, childId);
    if (ok) this.sql.prepare("UPDATE children SET active_buddy_id = ? WHERE id = ?").run(id, childId);
    return !!ok;
  }

  // ---- a buddy's files ----

  private toFile(r: any): BuddyFile {
    return { id: r.id, buddyId: r.buddy_id, name: r.name, kind: r.kind, size: r.size, createdAt: r.created_at, status: r.status, summary: r.summary };
  }

  listFiles(buddyId: number): BuddyFile[] {
    return (this.sql.prepare("SELECT * FROM buddy_files WHERE buddy_id = ? AND deleted_at IS NULL ORDER BY id DESC").all(buddyId) as any[]).map((r) => this.toFile(r));
  }

  /** A file with what's needed to serve or read it. Null if it doesn't exist or was removed. */
  fileById(id: number): FileRow | null {
    const r = this.sql.prepare("SELECT * FROM buddy_files WHERE id = ? AND deleted_at IS NULL").get(id) as any;
    return r ? { ...this.toFile(r), childId: r.child_id, mime: r.mime, path: r.path, text: r.text } : null;
  }

  addFile(f: { buddyId: number; childId: string; name: string; kind: FileKind; mime: string; size: number; path: string; status: BuddyFile["status"]; text?: string | null; summary?: string | null }): number {
    const info = this.sql
      .prepare("INSERT INTO buddy_files (buddy_id, child_id, name, kind, mime, size, path, status, text, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(f.buddyId, f.childId, f.name, f.kind, f.mime, f.size, f.path, f.status, f.text ?? null, f.summary ?? null);
    return Number(info.lastInsertRowid);
  }

  setFileRead(id: number, r: { status: BuddyFile["status"]; text: string | null; summary: string | null }) {
    this.sql.prepare("UPDATE buddy_files SET status = ?, text = ?, summary = ? WHERE id = ?").run(r.status, r.text, r.summary, id);
  }

  /** Removed files leave the list at once; their bytes are deleted by the caller. */
  /** Read photos that might still have a camera's name, to rename from their summary. */
  autoNamedFiles(): number[] {
    return this.sql.prepare("SELECT id FROM buddy_files WHERE deleted_at IS NULL AND status = 'ready' AND kind = 'image' AND summary IS NOT NULL").pluck().all() as number[];
  }

  renameFile(id: number, name: string) {
    this.sql.prepare("UPDATE buddy_files SET name = ? WHERE id = ? AND deleted_at IS NULL").run(name, id);
  }

  deleteFile(id: number) {
    this.sql.prepare("UPDATE buddy_files SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").run(now(), id);
  }

  // ---- a buddy's memory ----

  /** Child and tutor turns with this buddy after `afterId`, oldest first, for updating its memory. */
  turnsForMemory(buddyId: number, afterId: number, limit = 40): { id: number; role: "child" | "tutor"; text: string }[] {
    return (
      this.sql
        .prepare(
          `SELECT t.id, t.role, t.text FROM turns t JOIN sessions s ON s.id = t.session_id
           WHERE s.buddy_id = ? AND t.id > ? ORDER BY t.id DESC LIMIT ?`,
        )
        .all(buddyId, afterId, limit) as { id: number; role: "child" | "tutor"; text: string }[]
    ).reverse();
  }

  /** Buddies with turns not yet in their memory, whose latest turn is older than `before` (an ISO time). */
  buddiesWithIdleTurns(before: string): { childId: string; buddyId: number }[] {
    return this.sql
      .prepare(
        `SELECT b.child_id AS childId, b.id AS buddyId FROM buddies b
         JOIN sessions s ON s.buddy_id = b.id JOIN turns t ON t.session_id = s.id
         GROUP BY b.id HAVING MAX(t.id) > b.memory_turn_id AND MAX(t.created_at) < ?`,
      )
      .all(before) as { childId: string; buddyId: number }[];
  }

  memoryTurnId(buddyId: number): number {
    return (this.sql.prepare("SELECT memory_turn_id FROM buddies WHERE id = ?").pluck().get(buddyId) as number | undefined) ?? 0;
  }

  setMemoryTurnId(buddyId: number, turnId: number) {
    this.sql.prepare("UPDATE buddies SET memory_turn_id = ? WHERE id = ?").run(turnId, buddyId);
  }

  // ---- reminders and plans (schedules.ts) ----

  private toSchedule(r: any): Schedule {
    const rule = JSON.parse(r.rule_json) as ScheduleRule;
    return {
      id: r.id,
      buddyId: r.buddy_id,
      kind: r.kind,
      label: r.label,
      text: r.text,
      rule,
      when: describeRule(rule),
      status: r.status,
      nextAt: r.next_at,
      lastRunAt: r.last_run_at,
    };
  }

  listSchedules(childId: string): Schedule[] {
    return (this.sql.prepare("SELECT * FROM schedules WHERE child_id = ? ORDER BY COALESCE(next_at, created_at), id").all(childId) as any[]).map((r) => this.toSchedule(r));
  }

  scheduleById(id: number): Schedule | null {
    const r = this.sql.prepare("SELECT * FROM schedules WHERE id = ?").get(id);
    return r ? this.toSchedule(r) : null;
  }

  scheduleChild(id: number): string | null {
    return (this.sql.prepare("SELECT child_id FROM schedules WHERE id = ?").pluck().get(id) as string | undefined) ?? null;
  }

  addSchedule(s: { childId: string; buddyId: number; kind: "reminder" | "task"; label: string; text: string; rule: ScheduleRule }): number {
    return Number(
      this.sql
        .prepare("INSERT INTO schedules (child_id, buddy_id, kind, label, text, rule_json) VALUES (?, ?, ?, ?, ?, ?)")
        .run(s.childId, s.buddyId, s.kind, s.label, s.text, JSON.stringify(s.rule)).lastInsertRowid,
    );
  }

  setScheduleStatus(id: number, status: ScheduleStatus, nextAt: string | null) {
    this.sql.prepare("UPDATE schedules SET status = ?, next_at = ? WHERE id = ?").run(status, nextAt, id);
  }

  recordScheduleRun(id: number, at: string, result: string, status: ScheduleStatus, nextAt: string | null) {
    this.sql.prepare("UPDATE schedules SET last_run_at = ?, last_result = ?, status = ?, next_at = ? WHERE id = ?").run(at, result, status, nextAt, id);
  }

  /** Active schedules whose time has come, oldest first. */
  dueSchedules(now: string): { childId: string; schedule: Schedule }[] {
    return (this.sql.prepare("SELECT * FROM schedules WHERE status = 'active' AND next_at IS NOT NULL AND next_at <= ? ORDER BY next_at").all(now) as any[]).map((r) => ({
      childId: r.child_id,
      schedule: this.toSchedule(r),
    }));
  }

  /** Drop proposals made before `before` that were never confirmed. Returns the children affected. */
  expireProposals(before: string): string[] {
    const rows = this.sql.prepare("SELECT DISTINCT child_id FROM schedules WHERE status = 'proposed' AND created_at < ?").pluck().all(before) as string[];
    this.sql.prepare("UPDATE schedules SET status = 'cancelled' WHERE status = 'proposed' AND created_at < ?").run(before);
    return rows;
  }

  /**
   * Everything a removed buddy kept, other than the chats (which stay for the parent): its file records (with what was
   * read from them), its reminders and plans, and what it had to tell the child. The files' bytes are removed first.
   */
  purgeBuddy(buddyId: number) {
    this.sql.transaction(() => {
      this.sql.prepare("DELETE FROM buddy_files WHERE buddy_id = ?").run(buddyId);
      this.sql.prepare("DELETE FROM schedules WHERE buddy_id = ?").run(buddyId);
      this.sql.prepare("DELETE FROM nudges WHERE buddy_id = ?").run(buddyId);
      this.sql.prepare("DELETE FROM quiz_attempts WHERE quiz_id IN (SELECT id FROM quizzes WHERE buddy_id = ?)").run(buddyId);
      this.sql.prepare("DELETE FROM quizzes WHERE buddy_id = ?").run(buddyId);
    })();
  }

  // ---- quizzes (quizzes.ts) ----

  addQuiz(q: { childId: string; buddyId: number; app: string; topic: string; style: QuizStyle | null; count: number }): number {
    return Number(
      this.sql
        .prepare("INSERT INTO quizzes (child_id, buddy_id, app, topic, style, count, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(q.childId, q.buddyId, q.app, q.topic, q.style, q.count, q.style ? "making" : "offered").lastInsertRowid,
    );
  }

  quiz(id: number): QuizRow | null {
    const r = this.sql.prepare("SELECT * FROM quizzes WHERE id = ? AND deleted_at IS NULL").get(id) as any;
    return r
      ? {
          id: r.id,
          childId: r.child_id,
          buddyId: r.buddy_id,
          app: r.app,
          topic: r.topic,
          style: r.style,
          count: r.count,
          status: r.status,
          title: r.title,
          questions: r.questions_json ? JSON.parse(r.questions_json) : [],
        }
      : null;
  }

  setQuizStyle(id: number, style: QuizStyle) {
    this.sql.prepare("UPDATE quizzes SET style = ?, status = 'making' WHERE id = ? AND status = 'offered'").run(style, id);
  }

  setQuizMade(id: number, made: { title: string; questions: unknown[] } | null) {
    if (made) this.sql.prepare("UPDATE quizzes SET status = 'ready', title = ?, questions_json = ? WHERE id = ?").run(made.title, JSON.stringify(made.questions), id);
    else this.sql.prepare("UPDATE quizzes SET status = 'failed' WHERE id = ?").run(id);
  }

  /** A buddy's quizzes, newest first, with the best finished try and how many tries. */
  listQuizzes(buddyId: number): QuizSummary[] {
    return (
      this.sql
        .prepare(
          `SELECT q.*, (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.finished_at IS NOT NULL) AS attempts,
             (SELECT a.score || '/' || a.total FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.finished_at IS NOT NULL ORDER BY a.score DESC, a.id LIMIT 1) AS best
           FROM quizzes q WHERE q.buddy_id = ? AND q.deleted_at IS NULL AND q.status != 'failed' ORDER BY q.id DESC`,
        )
        .all(buddyId) as any[]
    ).map((r) => ({
      id: r.id,
      buddyId: r.buddy_id,
      title: r.title ?? r.topic,
      topic: r.topic,
      style: r.style,
      count: r.questions_json ? JSON.parse(r.questions_json).length : r.count,
      status: r.status,
      createdAt: r.created_at,
      best: r.best ? { score: Number(r.best.split("/")[0]), total: Number(r.best.split("/")[1]) } : null,
      attempts: r.attempts,
    }));
  }

  deleteQuiz(id: number) {
    this.sql.prepare("UPDATE quizzes SET deleted_at = ? WHERE id = ?").run(now(), id);
  }

  startAttempt(quizId: number, total: number): number {
    return Number(this.sql.prepare("INSERT INTO quiz_attempts (quiz_id, total) VALUES (?, ?)").run(quizId, total).lastInsertRowid);
  }

  attempt(id: number): { id: number; quizId: number; answers: any[]; finished: boolean } | null {
    const r = this.sql.prepare("SELECT * FROM quiz_attempts WHERE id = ?").get(id) as any;
    return r ? { id: r.id, quizId: r.quiz_id, answers: JSON.parse(r.answers_json), finished: !!r.finished_at } : null;
  }

  saveAttempt(id: number, answers: unknown[]) {
    this.sql.prepare("UPDATE quiz_attempts SET answers_json = ? WHERE id = ? AND finished_at IS NULL").run(JSON.stringify(answers), id);
  }

  finishAttempt(id: number, score: number) {
    this.sql.prepare("UPDATE quiz_attempts SET score = ?, finished_at = ? WHERE id = ? AND finished_at IS NULL").run(score, now(), id);
  }

  // ---- what buddies said on their own (nudges) ----

  addNudge(childId: string, buddyId: number, kind: Nudge["kind"], text: string) {
    this.sql.prepare("INSERT INTO nudges (child_id, buddy_id, kind, text) VALUES (?, ?, ?, ?)").run(childId, buddyId, kind, text.slice(0, 500));
  }

  /** Unseen nudges from the child's buddies that are still around, newest first. */
  unseenNudges(childId: string): Nudge[] {
    return (
      this.sql
        .prepare(
          `SELECT n.id, n.buddy_id, n.kind, n.text, n.created_at FROM nudges n JOIN buddies b ON b.id = n.buddy_id
           WHERE n.child_id = ? AND n.seen_at IS NULL AND b.deleted_at IS NULL ORDER BY n.id DESC LIMIT 20`,
        )
        .all(childId) as any[]
    ).map((r) => ({ id: r.id, buddyId: r.buddy_id, kind: r.kind, text: r.text, createdAt: r.created_at }));
  }

  /** Mark a buddy's nudges seen. True if there were any. */
  seeNudges(childId: string, buddyId: number): boolean {
    return this.sql.prepare("UPDATE nudges SET seen_at = ? WHERE child_id = ? AND buddy_id = ? AND seen_at IS NULL").run(now(), childId, buddyId).changes > 0;
  }

  // ---- the daily check-in (heartbeat.ts) ----

  heartbeatRan(childId: string, day: string): boolean {
    return !!this.sql.prepare("SELECT 1 FROM heartbeats WHERE child_id = ? AND day = ?").get(childId, day);
  }

  recordHeartbeat(childId: string, day: string, result: string, buddyId: number | null = null) {
    this.sql.prepare("INSERT OR REPLACE INTO heartbeats (child_id, day, ran_at, buddy_id, result) VALUES (?, ?, ?, ?, ?)").run(childId, day, now(), buddyId, result);
  }

  /** When the child last sent a message, or null. */
  lastChildMessageAt(childId: string): string | null {
    return (
      (this.sql.prepare("SELECT MAX(t.created_at) FROM turns t JOIN sessions s ON s.id = t.session_id WHERE s.child_id = ? AND t.role = 'child'").pluck().get(childId) as string | null) ?? null
    );
  }

  // ---- notifications (push.ts) ----

  addPushSubscription(deviceId: number, endpoint: string, keys: { p256dh: string; auth: string }) {
    this.sql
      .prepare("INSERT INTO push_subscriptions (device_id, endpoint, keys_json) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET device_id = excluded.device_id, keys_json = excluded.keys_json")
      .run(deviceId, endpoint, JSON.stringify(keys));
  }

  removePushSubscription(endpoint: string, deviceId?: number) {
    if (deviceId === undefined) this.sql.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
    else this.sql.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND device_id = ?").run(endpoint, deviceId);
  }

  removeDevicePushSubscriptions(deviceId: number) {
    this.sql.prepare("DELETE FROM push_subscriptions WHERE device_id = ?").run(deviceId);
  }

  /** Where to send a child's notifications: the subscriptions of their devices that are still paired. */
  pushSubscriptions(childId: string): { endpoint: string; keys: { p256dh: string; auth: string } }[] {
    return (
      this.sql
        .prepare("SELECT p.endpoint, p.keys_json FROM push_subscriptions p JOIN devices d ON d.id = p.device_id WHERE d.child_id = ? AND d.revoked_at IS NULL")
        .all(childId) as any[]
    ).map((r) => ({ endpoint: r.endpoint, keys: JSON.parse(r.keys_json) }));
  }

  hasPushSubscription(deviceId: number): boolean {
    return !!this.sql.prepare("SELECT 1 FROM push_subscriptions WHERE device_id = ?").get(deviceId);
  }

  // ---- devices and pairing ----

  createPairingToken(childId: string, ttlMinutes = 10): string {
    const token = newToken();
    const expires = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    this.sql.prepare("INSERT INTO pairing_tokens (token_hash, child_id, expires_at) VALUES (?, ?, ?)").run(hashToken(token), childId, expires);
    return token;
  }

  /** Swap a one-time pairing token for a long-lived device token. Null if unknown, used or expired. */
  redeemPairingToken(token: string, deviceName: string): { deviceToken: string; deviceId: number; childId: string } | null {
    return this.sql.transaction(() => {
      const row = this.sql.prepare("SELECT child_id, expires_at, used_at FROM pairing_tokens WHERE token_hash = ?").get(hashToken(token)) as
        | { child_id: string; expires_at: string; used_at: string | null }
        | undefined;
      if (!row || row.used_at || row.expires_at < now()) return null;
      this.sql.prepare("UPDATE pairing_tokens SET used_at = ? WHERE token_hash = ?").run(now(), hashToken(token));
      const deviceToken = newToken();
      const info = this.sql
        .prepare("INSERT INTO devices (child_id, name, token_hash) VALUES (?, ?, ?)")
        .run(row.child_id, deviceName.slice(0, 60) || "Device", hashToken(deviceToken));
      return { deviceToken, deviceId: Number(info.lastInsertRowid), childId: row.child_id };
    })();
  }

  deviceByToken(token: string): DeviceRow | null {
    const row = this.sql.prepare("SELECT id, child_id, name, revoked_at FROM devices WHERE token_hash = ?").get(hashToken(token)) as DeviceRow | undefined;
    return row && !row.revoked_at ? row : null;
  }

  deviceById(id: number): DeviceRow | null {
    return (this.sql.prepare("SELECT id, child_id, name, revoked_at FROM devices WHERE id = ?").get(id) as DeviceRow | undefined) ?? null;
  }

  touchDevice(id: number) {
    this.sql.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now(), id);
  }

  revokeDevice(id: number) {
    this.sql.prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now(), id);
  }

  listDevices(): ParentDevice[] {
    return (this.sql.prepare("SELECT * FROM devices ORDER BY revoked_at IS NOT NULL, paired_at DESC").all() as any[]).map((r) => ({
      id: r.id,
      childId: r.child_id,
      name: r.name,
      pairedAt: r.paired_at,
      lastSeenAt: r.last_seen_at,
      revokedAt: r.revoked_at,
    }));
  }

  // ---- sessions (sittings) ----

  /** The child's latest sitting, optionally only for one app and/or one buddy (null: sittings without a buddy). */
  latestSession(childId: string, app?: string, buddyId?: number | null): SessionRow | null {
    const where = ["child_id = @childId"];
    if (app) where.push("app = @app");
    if (buddyId !== undefined) where.push("buddy_id IS @buddyId");
    const q = this.sql.prepare(`SELECT * FROM sessions WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 1`).get({ childId, app, buddyId });
    return (q as SessionRow | undefined) ?? null;
  }

  lastActivity(sessionId: number): string {
    return this.sql
      .prepare("SELECT COALESCE((SELECT MAX(created_at) FROM turns WHERE session_id = ?), (SELECT started_at FROM sessions WHERE id = ?))")
      .pluck()
      .get(sessionId, sessionId) as string;
  }

  /** The current sitting, or a new one when the last went idle. `created` tells the caller to start a fresh Pi session. */
  currentSession(childId: string, app: string, idleMinutes: number, buddyId: number | null = null): { session: SessionRow; created: boolean } {
    const last = this.latestSession(childId, app, buddyId);
    if (last) {
      const idleMs = Date.now() - Date.parse(this.lastActivity(last.id));
      if (idleMs < idleMinutes * 60_000) return { session: last, created: false };
      this.sql.prepare("UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL").run(this.lastActivity(last.id), last.id);
    }
    const info = this.sql.prepare("INSERT INTO sessions (child_id, app, buddy_id) VALUES (?, ?, ?)").run(childId, app, buddyId);
    return { session: this.sql.prepare("SELECT * FROM sessions WHERE id = ?").get(info.lastInsertRowid) as SessionRow, created: true };
  }

  sessionApp(sessionId: number): string {
    return (this.sql.prepare("SELECT app FROM sessions WHERE id = ?").pluck().get(sessionId) as string | undefined) ?? "";
  }

  setPiSessionId(sessionId: number, piSessionId: string) {
    this.sql.prepare("UPDATE sessions SET pi_session_id = ? WHERE id = ?").run(piSessionId, sessionId);
  }

  // ---- turns and their audit trail ----

  insertTurn(t: { sessionId: number; role: "child" | "tutor"; text: string; intent?: unknown; action?: unknown }): number {
    const info = this.sql
      .prepare("INSERT INTO turns (session_id, role, text, intent_json, action_json) VALUES (?, ?, ?, ?, ?)")
      .run(t.sessionId, t.role, t.text, json(t.intent), json(t.action));
    return Number(info.lastInsertRowid);
  }

  insertBlockedDraft(turnId: number, text: string, reason: string) {
    this.sql.prepare("INSERT INTO blocked_drafts (turn_id, text, reason) VALUES (?, ?, ?)").run(turnId, text, reason);
  }

  insertToolCall(turnId: number, tool: string, args: unknown, accepted: boolean, error: string | null) {
    this.sql.prepare("INSERT INTO tool_calls (turn_id, tool, args_json, accepted, error) VALUES (?, ?, ?, ?, ?)").run(turnId, tool, JSON.stringify(args), accepted ? 1 : 0, error);
  }

  // ---- problems (hint ladder) ----

  /** The open problem in the chat with this buddy (null: chats without a buddy). */
  activeProblem(childId: string, buddyId: number | null = null): ProblemRow | null {
    return (
      (this.sql
        .prepare("SELECT * FROM problems WHERE child_id = ? AND buddy_id IS ? AND solved_at IS NULL AND closed_at IS NULL ORDER BY id DESC LIMIT 1")
        .get(childId, buddyId) as ProblemRow | undefined) ?? null
    );
  }

  problem(id: number): ProblemRow | null {
    return (this.sql.prepare("SELECT * FROM problems WHERE id = ?").get(id) as ProblemRow | undefined) ?? null;
  }

  /** Start a new ladder. Any other open problem in the chat with the same buddy is closed. */
  createProblem(p: { sessionId: number; childId: string; buddyId?: number | null; subject: string | null; label: string; text: string }): ProblemRow {
    const buddyId = p.buddyId ?? null;
    return this.sql.transaction(() => {
      this.sql.prepare("UPDATE problems SET closed_at = ? WHERE child_id = ? AND buddy_id IS ? AND solved_at IS NULL AND closed_at IS NULL").run(now(), p.childId, buddyId);
      const info = this.sql
        .prepare("INSERT INTO problems (session_id, child_id, buddy_id, subject, label, text) VALUES (?, ?, ?, ?, ?, ?)")
        .run(p.sessionId, p.childId, buddyId, p.subject, p.label.slice(0, 120), p.text.slice(0, 2000));
      return this.problem(Number(info.lastInsertRowid))!;
    })();
  }

  updateProblem(id: number, patch: Partial<Pick<ProblemRow, "rung" | "attempts" | "correct" | "label" | "text" | "subject" | "solved_at">>) {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length) return;
    this.sql.prepare(`UPDATE problems SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ ...patch, id });
  }

  // ---- alerts ----

  insertAlert(a: { childId: string; turnId: number | null; severity: string; summary: string }): number {
    const info = this.sql.prepare("INSERT INTO alerts (child_id, turn_id, severity, summary) VALUES (?, ?, ?, ?)").run(a.childId, a.turnId, a.severity, a.summary);
    return Number(info.lastInsertRowid);
  }

  setAlertTurn(alertId: number, turnId: number) {
    this.sql.prepare("UPDATE alerts SET turn_id = ? WHERE id = ?").run(turnId, alertId);
  }

  listAlerts(): ParentAlert[] {
    return (
      this.sql
        .prepare(
          `SELECT a.*, c.name AS child_name, t.session_id FROM alerts a
           JOIN children c ON c.id = a.child_id LEFT JOIN turns t ON t.id = a.turn_id
           ORDER BY a.id DESC LIMIT 500`,
        )
        .all() as any[]
    ).map((r) => ({
      id: r.id,
      childId: r.child_id,
      childName: r.child_name,
      turnId: r.turn_id,
      sessionId: r.session_id ?? null,
      severity: r.severity,
      summary: r.summary,
      sentAt: r.sent_at,
      readAt: r.read_at,
    }));
  }

  markAlertRead(id: number) {
    this.sql.prepare("UPDATE alerts SET read_at = ? WHERE id = ? AND read_at IS NULL").run(now(), id);
  }

  // ---- child-visible chat log ----

  appendUi(childId: string, sessionId: number, item: ChatItem, turnId: number | null = null): SequencedItem {
    const info = this.sql
      .prepare("INSERT INTO ui_events (child_id, session_id, item_json, turn_id) VALUES (?, ?, ?, ?)")
      .run(childId, sessionId, JSON.stringify(item), turnId);
    return { seq: Number(info.lastInsertRowid), at: now(), item };
  }

  /**
   * Items a device is missing from the chat with a buddy. If the device's last seen item belongs to an older sitting,
   * it gets the whole current sitting with reset=true.
   */
  /** A device catching up on one app's chat with a buddy: everything since `since`, or the whole latest sitting. */
  uiSync(childId: string, since: number, buddyId: number | null = null, app = "homework"): { items: SequencedItem[]; reset: boolean } {
    const latest = this.latestSession(childId, app, buddyId);
    if (!latest) return { items: [], reset: true };
    const first = this.sql.prepare("SELECT MIN(seq) FROM ui_events WHERE session_id = ?").pluck().get(latest.id) as number | null;
    const reset = since <= 0 || first === null || since < first - 1;
    const rows = this.sql
      .prepare("SELECT seq, item_json, created_at FROM ui_events WHERE session_id = ? AND seq > ? ORDER BY seq")
      .all(latest.id, reset ? 0 : since) as { seq: number; item_json: string; created_at: string }[];
    return { items: rows.map((r) => ({ seq: r.seq, at: r.created_at, item: JSON.parse(r.item_json) })), reset };
  }

  // ---- token budget ----

  picturesToday(childId: string): number {
    return (this.sql.prepare("SELECT pictures FROM usage WHERE child_id = ? AND day = ?").pluck().get(childId, localDay()) as number | undefined) ?? 0;
  }

  addPicture(childId: string) {
    this.sql.prepare("INSERT INTO usage (child_id, day, tokens, pictures) VALUES (?, ?, 0, 1) ON CONFLICT(child_id, day) DO UPDATE SET pictures = pictures + 1").run(childId, localDay());
  }

  lookupsToday(childId: string): number {
    return (this.sql.prepare("SELECT lookups FROM usage WHERE child_id = ? AND day = ?").pluck().get(childId, localDay()) as number | undefined) ?? 0;
  }

  addLookup(childId: string) {
    this.sql.prepare("INSERT INTO usage (child_id, day, tokens, lookups) VALUES (?, ?, 0, 1) ON CONFLICT(child_id, day) DO UPDATE SET lookups = lookups + 1").run(childId, localDay());
  }

  addUsage(childId: string, tokens: number) {
    if (!tokens) return;
    this.sql
      .prepare("INSERT INTO usage (child_id, day, tokens) VALUES (?, ?, ?) ON CONFLICT(child_id, day) DO UPDATE SET tokens = tokens + excluded.tokens")
      .run(childId, localDay(), Math.round(tokens));
  }

  usageToday(childId: string): number {
    return (this.sql.prepare("SELECT tokens FROM usage WHERE child_id = ? AND day = ?").pluck().get(childId, localDay()) as number | undefined) ?? 0;
  }

  // ---- parent view ----

  /** Totals over a child's sittings, or just those with one buddy. */
  sessionStats(childId: string, buddyId?: number): ParentStats {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const r = this.sql
      .prepare(
        `SELECT COUNT(*) AS sessions,
           COALESCE(SUM(s.started_at >= @weekAgo), 0) AS thisWeek,
           COALESCE(SUM((SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id)), 0) AS messages,
           COALESCE(SUM((SELECT COUNT(*) FROM problems p WHERE p.session_id = s.id)), 0) AS attempted,
           COALESCE(SUM((SELECT COUNT(*) FROM problems p WHERE p.session_id = s.id AND p.solved_at IS NOT NULL)), 0) AS solved,
           COALESCE(SUM((SELECT COUNT(*) FROM alerts a JOIN turns t ON t.id = a.turn_id WHERE t.session_id = s.id)), 0) AS alerts,
           COALESCE(SUM((SELECT COUNT(*) FROM blocked_drafts b JOIN turns t ON t.id = b.turn_id WHERE t.session_id = s.id)), 0) AS blocked,
           COALESCE(SUM((julianday((SELECT MAX(created_at) FROM turns t WHERE t.session_id = s.id)) - julianday(s.started_at)) * 1440), 0) AS minutes,
           MAX((SELECT MAX(created_at) FROM turns t WHERE t.session_id = s.id)) AS lastAt
         FROM sessions s WHERE s.child_id = @childId ${buddyId === undefined ? "" : "AND s.buddy_id = @buddyId"}`,
      )
      .get({ childId, buddyId, weekAgo }) as any;
    return {
      sessions: r.sessions,
      sessionsThisWeek: r.thisWeek,
      messages: r.messages,
      problemsAttempted: r.attempted,
      problemsSolved: r.solved,
      alerts: r.alerts,
      blocked: r.blocked,
      minutes: Math.round(r.minutes),
      lastActiveAt: r.lastAt ?? null,
    };
  }

  /** The problems worked on in one sitting, in order. */
  sessionProblems(sessionId: number): ParentSessionProblem[] {
    return (this.sql.prepare("SELECT label, subject, rung, attempts, solved_at FROM problems WHERE session_id = ? ORDER BY id").all(sessionId) as any[]).map((p) => ({
      label: p.label,
      subject: p.subject,
      rung: p.rung,
      attempts: p.attempts,
      solved: !!p.solved_at,
    }));
  }

  listSessions(filter: { childId?: string; buddyId?: number } = {}): ParentSessionSummary[] {
    const where = [filter.childId ? "s.child_id = @childId" : "", filter.buddyId !== undefined ? "s.buddy_id = @buddyId" : ""].filter(Boolean);
    const rows = this.sql
      .prepare(
        `SELECT s.*, c.name AS child_name,
           (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) AS turns,
           (SELECT COUNT(*) FROM problems p WHERE p.session_id = s.id) AS attempted,
           (SELECT COUNT(*) FROM problems p WHERE p.session_id = s.id AND p.solved_at IS NOT NULL) AS solved,
           (SELECT COUNT(*) FROM alerts a JOIN turns t ON t.id = a.turn_id WHERE t.session_id = s.id) AS alerts,
           (SELECT GROUP_CONCAT(DISTINCT p.subject) FROM problems p WHERE p.session_id = s.id) AS subjects,
           COALESCE((julianday((SELECT MAX(created_at) FROM turns t WHERE t.session_id = s.id)) - julianday(s.started_at)) * 1440, 0) AS minutes
         FROM sessions s JOIN children c ON c.id = s.child_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY s.id DESC LIMIT 300`,
      )
      .all(filter) as any[];
    return rows.map((r) => ({
      id: r.id,
      childId: r.child_id,
      childName: r.child_name,
      app: r.app,
      buddy: this.buddyById(r.buddy_id),
      startedAt: r.started_at,
      endedAt: r.ended_at,
      subjects: r.subjects ? String(r.subjects).split(",") : [],
      problemsAttempted: r.attempted,
      problemsSolved: r.solved,
      alerts: r.alerts,
      turns: r.turns,
      minutes: Math.round(r.minutes),
    }));
  }

  transcript(sessionId: number): ParentTurn[] {
    const turns = this.sql.prepare("SELECT * FROM turns WHERE session_id = ? ORDER BY id").all(sessionId) as any[];
    const blocked = this.sql.prepare("SELECT text, reason FROM blocked_drafts WHERE turn_id = ? ORDER BY id");
    const tools = this.sql.prepare("SELECT tool, args_json, accepted, error FROM tool_calls WHERE turn_id = ? ORDER BY id");
    const alerts = this.sql.prepare("SELECT severity, summary FROM alerts WHERE turn_id = ? ORDER BY id");
    const items = this.sql.prepare("SELECT item_json FROM ui_events WHERE turn_id = ? ORDER BY seq").pluck();
    return turns.map((t) => ({
      id: t.id,
      role: t.role,
      text: t.text,
      createdAt: t.created_at,
      intent: parse(t.intent_json),
      action: parse(t.action_json),
      blocked: blocked.all(t.id) as { text: string; reason: string }[],
      toolCalls: (tools.all(t.id) as any[]).map((c) => ({ tool: c.tool, args: JSON.parse(c.args_json), accepted: !!c.accepted, error: c.error })),
      alerts: alerts.all(t.id) as { severity: string; summary: string }[],
      items: (items.all(t.id) as string[]).map((j) => JSON.parse(j) as ChatItem),
    }));
  }

  /** Turns created after `afterId` for a child, for `openbuddies logs`. */
  turnsAfter(childId: string, afterId: number, limit = 200) {
    return this.sql
      .prepare(
        `SELECT t.id, t.role, t.text, t.intent_json, t.action_json, t.created_at,
           (SELECT COUNT(*) FROM blocked_drafts b WHERE b.turn_id = t.id) AS blocked
         FROM turns t JOIN sessions s ON s.id = t.session_id
         WHERE s.child_id = ? AND t.id > ? ORDER BY t.id LIMIT ?`,
      )
      .all(childId, afterId, limit) as any[];
  }

  lastTurnId(childId: string): number {
    return (this.sql.prepare("SELECT MAX(t.id) FROM turns t JOIN sessions s ON s.id = t.session_id WHERE s.child_id = ?").pluck().get(childId) as number | null) ?? 0;
  }
}
