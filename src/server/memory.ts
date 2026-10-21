// A buddy's memory: short notes about what the child has worked on with it, so the next chat can pick up where the
// last one left off. Kept as Markdown in data/memory/<child>/<buddy>.md, so a parent can read or edit it by hand.
//
// The check model rewrites the notes once a sitting is over (idle for the sitting timeout, or the child switched
// buddy), straight after the child asks the buddy to remember something, and part-way through a very long sitting. Its output is checked in code before it's saved: lines that claim
// rules or permissions, or give the tutor instructions, are dropped, because the notes reach every future chat and the
// model never polices itself. The tutor gets them each turn fenced as material, outside the server's instructions.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StructuredCaller } from "./classifier.js";
import type { Db } from "./db.js";
import { fenceMaterial, foldLookalikes, MEMORY_SCHEMA, MEMORY_SYSTEM, sanitiseChildText } from "./prompts.js";

const MAX_NOTES = 1500;
/** Unremembered turns that trigger an update before the sitting ends, so the start of a long one isn't lost. */
export const LONG_SITTING_TURNS = 40;

export const memoryPath = (home: string, childId: string, buddyId: number) => join(home, "data", "memory", childId, `${buddyId}.md`);

export function readMemory(home: string, childId: string, buddyId: number): { text: string; updatedAt: string } | null {
  const path = memoryPath(home, childId, buddyId);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8").trim();
  return text ? { text, updatedAt: statSync(path).mtime.toISOString() } : null;
}

export function clearMemory(home: string, childId: string, buddyId: number) {
  const path = memoryPath(home, childId, buddyId);
  rmSync(path, { force: true });
  rmSync(`${path}.bak`, { force: true });
}

/** Notes as the tutor sees them, fenced as material rather than instructions. Null when there are none. */
export function memoryBlock(notes: string | null, childName: string, fenceId: string): string | null {
  if (!notes) return null;
  return fenceMaterial(fenceId, `Your notes from earlier chats with ${childName}, to pick up where you left off.`, notes.slice(0, MAX_NOTES));
}

// A line the notes may never keep, whatever the note keeper wrote. These are what a child (or a photo) would try in
// order to plant a rule in every future chat: permission claims, instructions to the tutor, talk of the rules.
const NOT_A_NOTE = [
  /\b(give|gives|giving|tell|tells|reveal|reveals|hand over)\b[^.\n]{0,40}\b(answers?|solutions?)\b/i,
  /\b(allowed|permitted|permission)\b/i,
  /\b(says?|said|lets?)\b[^.\n]{0,40}\b(ok|okay|fine|can have|can get|can see|can use|may have)\b/i,
  /\byou (must|may|are allowed|are now|can now|should now|have to|need to)\b/i,
  /\b(ignore|forget|override|change|break|skip|turn off|switch off)\b[^.\n]{0,20}\b(rules?|instructions?|limits?|help level)\b/i,
  /\b(system prompt|nonce|openbuddies-action|child-material|reveal mode|relaxed mode|strict mode)\b/i,
  /<\/?[a-z][\w-]*[^>]*>/i,
];

/** Keep only lines that are notes about learning. Returns the kept notes and the dropped lines. */
export function checkNotes(raw: string): { notes: string; dropped: string[] } {
  const dropped: string[] = [];
  const kept = foldLookalikes(raw)
    .split("\n")
    .filter((line) => {
      const bad = NOT_A_NOTE.some((re) => re.test(line));
      if (bad) dropped.push(line.trim());
      return !bad;
    });
  // Drop headings left with nothing under them.
  const notes = kept
    .filter((line, i) => !/^#+\s/.test(line) || kept.slice(i + 1).find((l) => l.trim())?.match(/^\s*[-*]/))
    .join("\n")
    .trim()
    .slice(0, MAX_NOTES);
  return { notes, dropped };
}

export interface MemoryKeeperDeps {
  db: Db;
  model: StructuredCaller;
  home: () => string;
  /** How long a sitting can be idle before it's over (the household's session timeout). */
  idleMinutes: () => number;
  /** False turns memory off. */
  enabled?: boolean;
  log?: (msg: string) => void;
}

export class MemoryKeeper {
  private running = new Set<number>();

  constructor(private deps: MemoryKeeperDeps) {}

  /** After a turn: update now only if the sitting has run long. */
  afterTurn(childId: string, buddyId: number): Promise<void> {
    const { db } = this.deps;
    if (db.turnsForMemory(buddyId, db.memoryTurnId(buddyId), LONG_SITTING_TURNS).length < LONG_SITTING_TURNS) return Promise.resolve();
    return this.updateInBackground(childId, buddyId);
  }

  /** Update now: the child left this buddy (switched to another), or asked it to remember something. */
  updateNow(childId: string, buddyId: number): Promise<void> {
    return this.updateInBackground(childId, buddyId);
  }

  /** Update every buddy whose sitting has gone idle. Run every minute, and at startup to catch up. */
  async sweep(now = new Date()): Promise<void> {
    const before = new Date(now.getTime() - this.deps.idleMinutes() * 60_000).toISOString();
    for (const { childId, buddyId } of this.deps.db.buddiesWithIdleTurns(before)) await this.updateInBackground(childId, buddyId);
  }

  /** Sweep every minute. Returns a function that stops it. */
  start(): () => void {
    if (this.deps.enabled === false) return () => {};
    void this.sweep();
    const timer = setInterval(() => void this.sweep(), 60_000);
    timer.unref();
    return () => clearInterval(timer);
  }

  private updateInBackground(childId: string, buddyId: number): Promise<void> {
    if (this.deps.enabled === false || this.running.has(buddyId)) return Promise.resolve();
    this.running.add(buddyId);
    return this.update(childId, buddyId)
      .catch((e) => this.deps.log?.(`memory update failed for buddy ${buddyId}: ${(e as Error).message}`))
      .finally(() => this.running.delete(buddyId));
  }

  async update(childId: string, buddyId: number): Promise<void> {
    const { db, model, log } = this.deps;
    const home = this.deps.home();
    const turns = db.turnsForMemory(buddyId, db.memoryTurnId(buddyId));
    if (!turns.length) return;
    const before = readMemory(home, childId, buddyId)?.text ?? null;
    const conversation = turns
      .map((t) => `${t.role === "child" ? "Child" : "Buddy"}: ${sanitiseChildText(t.text)}`)
      .join("\n")
      .slice(-8000);
    const res = await model.completeStructured<{ changed?: boolean; notes?: string }>({
      system: MEMORY_SYSTEM,
      user: `Your notes so far:\n"""\n${before ?? "(none yet)"}\n"""\n\nThe latest conversation:\n"""\n${conversation}\n"""\n\nUpdate your notes.`,
      toolName: "buddy_memory",
      description: "Save the updated notes",
      schema: MEMORY_SCHEMA,
      model: "check",
      maxTokens: 700,
    });
    db.addUsage(childId, res.tokens);
    // A failed call leaves the turns to try again on the next sweep.
    if (!res.value) throw new Error(res.error ?? "no notes returned");
    // Whatever happens next, these turns have been looked at.
    db.setMemoryTurnId(buddyId, turns.at(-1)!.id);
    if (res.value.changed === false || typeof res.value.notes !== "string") return;

    const { notes, dropped } = checkNotes(res.value.notes);
    if (dropped.length) log?.(`memory for buddy ${buddyId}: dropped ${dropped.length} line(s) that weren't notes about learning`);
    if (!notes) return;
    if (before && before.length > 400 && notes.length < before.length / 3) {
      log?.(`memory for buddy ${buddyId}: kept the old notes (the update would have dropped most of them)`);
      return;
    }
    const path = memoryPath(home, childId, buddyId);
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) renameSync(path, `${path}.bak`);
    writeFileSync(path, notes + "\n", { mode: 0o600 });
    log?.(`memory updated for buddy ${buddyId}`);
  }
}
