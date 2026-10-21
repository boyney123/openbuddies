// Checks what a child (or parent) sends to make or change a buddy. Everything here ends up in the tutor's
// instructions, so only cleaned values get through.

import { cleanBuddyDescription, cleanBuddyName, cleanWear, isBuddyColor, MAX_BUDDY_DESCRIPTION, MAX_SUBJECTS, normaliseSubject, subjectLabel, type Buddy } from "../shared/protocol.js";
import type { BuddyFields } from "./db.js";

/**
 * The cleaned buddy, or a message the child can act on. `subjects` are the child's subjects. A subject the child
 * doesn't have yet comes back as `newSubject` too, for the caller to add (as Strict).
 */
export function validateBuddy(input: unknown, subjects: readonly string[]): (BuddyFields & { newSubject: string | null }) | { error: string } {
  const b = (input ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? cleanBuddyName(b.name) : null;
  if (!name) return { error: "Pick a name using letters and numbers (up to 20)." };
  if (!isBuddyColor(b.color)) return { error: "Pick one of the colours." };
  const description = cleanBuddyDescription(typeof b.description === "string" ? b.description : "");
  if (description === null) return { error: `Keep the description to ${MAX_BUDDY_DESCRIPTION} characters.` };
  const raw = b.subject === null || b.subject === undefined || b.subject === "" ? null : String(b.subject);
  const subject = raw === null ? null : normaliseSubject(raw);
  if (raw !== null && !subject) return { error: "Use letters for the subject, like Chess or Coding." };
  const isNew = subject !== null && !subjects.includes(subject);
  if (isNew && subjects.length >= MAX_SUBJECTS) return { error: "That's a lot of subjects! Pick one you already have." };
  return { name, color: b.color, description, subject, wear: b.wear === undefined ? undefined : cleanWear(b.wear), newSubject: isNew ? subject : null };
}

/** Who the tutor is in this chat, for its instructions. */
export interface BuddyPersona {
  name: string;
  description: string;
  /** Display label, e.g. "Design technology". */
  subject: string | null;
}

/** The persona for a buddy. A subject the parent has since removed from the child is ignored. */
export function personaFor(buddy: Buddy | null, subjects: readonly string[]): BuddyPersona | null {
  if (!buddy) return null;
  return { name: buddy.name, description: buddy.description, subject: buddy.subject && subjects.includes(buddy.subject) ? subjectLabel(buddy.subject) : null };
}
