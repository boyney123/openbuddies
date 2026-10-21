// Types shared by the server and the PWA. Everything here may reach the child's device,
// so nothing in this file may carry rules, prompts, classifier labels or keys.

export const RUNGS = ["ask", "nudge", "worked_example", "check"] as const;
export type Rung = (typeof RUNGS)[number];

export interface ProblemView {
  label: string;
  text: string;
  rung: Rung;
  solved: boolean;
}

/** A file shown with a message: enough to draw a chip or thumbnail. */
export interface FileRef {
  id: number;
  name: string;
  kind: FileKind;
}

/** One item in the child's chat. Persisted, so every device can replay it. */
export type ChatItem =
  | { kind: "child"; text: string; files?: FileRef[] }
  | { kind: "tutor"; text: string }
  | { kind: "hint"; rung: Rung; text: string }
  | { kind: "worked_example"; problem: string; steps: string[] }
  | { kind: "check"; answer: string; correct: boolean; feedback: string }
  | { kind: "solved"; label: string }
  | { kind: "notice"; text: string }
  /** The buddy offering to set up a reminder or plan; the child taps to confirm. Its status comes from the schedules. */
  | { kind: "schedule"; scheduleId: number; label: string; when: string; task: boolean }
  /** The buddy checking in on its own, once in a while (the daily heartbeat): "your spelling test is tomorrow…". */
  | { kind: "checkin"; text: string }
  /** The buddy offering to make a quiz: the child picks multiple choice or typed answers. */
  | { kind: "quiz_offer"; quizId: number; topic: string }
  /** A quiz the buddy made, ready to take. */
  | { kind: "quiz"; quizId: number; title: string; count: number; style: QuizStyle }
  /** How the child did on a quiz. */
  | { kind: "quiz_result"; quizId: number; title: string; score: number; total: number }
  /** A picture made in Picture Studio, kept in the buddy's files. */
  | { kind: "picture"; file: FileRef; title: string }
  /** The buddy looked something up on the internet for this reply; where the facts came from. */
  | { kind: "looked_up"; sources: { title: string; site: string; url: string }[] }
  /** Files the buddy found from what the child said ("our history homework") and looked at for this reply. */
  | { kind: "files_used"; files: FileRef[] }
  /** A reminder or plan going off. */
  | { kind: "reminder"; scheduleId: number; label: string; text: string; task: boolean };

/**
 * When a schedule goes off, in the household machine's local time: once on a date, or on some weekdays (0 = Sunday)
 * every week. Times are "HH:MM", 24-hour.
 */
export type ScheduleRule = { repeat: "once"; date: string; time: string } | { repeat: "weekly"; days: number[]; time: string };

export type ScheduleStatus = "proposed" | "active" | "paused" | "done" | "cancelled";

/** A reminder (a fixed message) or a task (the buddy does something, e.g. a quiz) the child set up with a buddy. */
export interface Schedule {
  id: number;
  buddyId: number;
  kind: "reminder" | "task";
  /** Short title, e.g. "Pack PE kit". */
  label: string;
  /** The reminder's message, or what the buddy should do. */
  text: string;
  rule: ScheduleRule;
  /** The rule in words, e.g. "Weekdays at 4:00pm". */
  when: string;
  status: ScheduleStatus;
  nextAt: string | null;
  lastRunAt: string | null;
}

/** Multiple choice (pick one of a few), or single answer (type it). */
export type QuizStyle = "multiple_choice" | "single_answer";

/** A quiz in the buddy's list, without its answers. */
export interface QuizSummary {
  id: number;
  buddyId: number;
  title: string;
  topic: string;
  style: QuizStyle | null;
  count: number;
  status: "offered" | "making" | "ready" | "failed";
  createdAt: string;
  /** The best finished try, if any. */
  best: { score: number; total: number } | null;
  attempts: number;
}

/** A question as the child sees it while taking the quiz: never its answer. */
export interface QuizQuestionView {
  question: string;
  /** Multiple choice: the options (in a fresh order each try). */
  choices: string[] | null;
}

/** What checking one answer says. The answer and explanation come once the question is over. */
export interface QuizAnswerResult {
  correct: boolean;
  /** The question is over (right, or two tries used). */
  done: boolean;
  hint?: string;
  answer?: string;
  explanation?: string;
}

export interface QuizReview {
  score: number;
  total: number;
  questions: { question: string; tries: string[]; correct: boolean; answer: string; explanation: string }[];
}

/** Something a buddy said on its own that the child hasn't seen yet, for its speech bubble on the home screen. */
export interface Nudge {
  id: number;
  buddyId: number;
  kind: "reminder" | "plan" | "checkin";
  text: string;
  createdAt: string;
}

export const SCHEDULE_LIMITS = { perChild: 10, labelLength: 60, textLength: 300 };

export interface SequencedItem {
  seq: number;
  at: string;
  item: ChatItem;
}

/**
 * The tutor's look, picked by the child. Colours are named so the server never handles CSS. `on` is the colour for
 * icons drawn on top of `main`.
 */
export const BUDDY_COLORS = {
  blue: { main: "#2F80FF", on: "#FFFFFF" },
  coral: { main: "#FF6B5E", on: "#FFFFFF" },
  mint: { main: "#34C98A", on: "#102A5C" },
  sunny: { main: "#FFB020", on: "#102A5C" },
  grape: { main: "#8B5CF6", on: "#FFFFFF" },
  berry: { main: "#EC4899", on: "#FFFFFF" },
  teal: { main: "#14B8A6", on: "#102A5C" },
  navy: { main: "#102A5C", on: "#FFFFFF" },
} as const;
export type BuddyColor = keyof typeof BUDDY_COLORS;

/** A study buddy. A child has one main buddy (their first) and can make more. */
export interface Buddy {
  id: number;
  name: string;
  color: BuddyColor;
  /** The child's description of who the buddy is, e.g. "a friendly maths teacher". May be empty. */
  description: string;
  /** A subject the buddy specialises in (one of the child's subjects), or null for any subject. */
  subject: string | null;
  main: boolean;
  /** What it's wearing, picked by the child: at most one thing on its head, over its eyes and round its neck. */
  wear: Accessory[];
}

/** Things a buddy can wear, and where each one goes. */
export const ACCESSORIES = {
  cap: "head",
  beanie: "head",
  crown: "head",
  party: "head",
  wizard: "head",
  headphones: "head",
  glasses: "eyes",
  sunglasses: "eyes",
  chain: "neck",
  scarf: "neck",
  bowtie: "neck",
  medal: "neck",
} as const;
export type Accessory = keyof typeof ACCESSORIES;
export type WearSlot = (typeof ACCESSORIES)[Accessory];

/** Known accessories only, one per place (the last one given wins). */
export function cleanWear(list: unknown): Accessory[] {
  if (!Array.isArray(list)) return [];
  const bySlot = new Map<WearSlot, Accessory>();
  for (const a of list) if (typeof a === "string" && Object.hasOwn(ACCESSORIES, a)) bySlot.set(ACCESSORIES[a as Accessory], a as Accessory);
  return [...bySlot.values()];
}

/** What a child (or parent) fills in to make or change a buddy. */
export interface BuddyInput {
  name: string;
  color: string;
  description: string;
  subject: string | null;
  /** What it's wearing; left out when changing a buddy, it keeps what it has. */
  wear?: Accessory[];
}

export const MAX_BUDDIES = 10;

export type FileKind = "image" | "text";

/** A file kept with a buddy. `summary` is a one-line description of what the buddy read in it. */
export interface BuddyFile {
  id: number;
  buddyId: number;
  name: string;
  kind: FileKind;
  size: number;
  createdAt: string;
  /** reading: the buddy is still reading it (a photo being transcribed); failed: it couldn't be read. */
  status: "reading" | "ready" | "failed";
  summary: string | null;
}

/** Limits for a buddy's files. Photos are shrunk on the device before upload, so they're well under the size limit. */
/**
 * A name a camera or phone made up rather than a person: long numbers, IMG_1234, PXL_…, image.jpg, a UUID, or the
 * "Photo 21 Oct 4.05pm" the app gives camera photos. These get replaced by what the photo shows once it's read.
 */
export function isAutoFileName(name: string): boolean {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "").trim();
  return (
    !base ||
    /^\d{6,}$/.test(base) ||
    /^(img|pxl|dsc|dscn|dcim|mvimg|photo|image|picture|pic|screenshot|camera)[\s_-]*[\d_ .:-]*(at[\d_ .:-]*)?$/i.test(base) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base) ||
    /^(photo|image) \d{1,2} [a-z]{3} \d{1,2}[.:]\d{2}(am|pm)$/i.test(base)
  );
}

export const FILE_LIMITS = { maxBytes: 8 * 1024 * 1024, perBuddy: 100, perMessage: 4, nameLength: 80 } as const;
/** A child can add subjects when making a buddy, up to this many subjects in all. */
export const MAX_SUBJECTS = 20;

/** "Design & Technology" -> "design-technology". Returns null if the result isn't a usable name. */
export function normaliseSubject(name: string): string | null {
  const s = name.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[a-z][a-z0-9-]{1,29}$/.test(s) && s !== "other" ? s : null;
}

/** "design-technology" -> "Design technology". */
export function subjectLabel(subject: string): string {
  const words = subject.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export const MAX_BUDDY_DESCRIPTION = 160;

/**
 * A usable buddy name, or null. The name reaches the tutor's instructions, so only letters, numbers, spaces,
 * apostrophes and hyphens are allowed, up to 20 characters.
 */
export function cleanBuddyName(raw: string): string | null {
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  return /^[\p{L}\p{N}][\p{L}\p{N} '\-]{0,19}$/u.test(name) ? name : null;
}

/**
 * A usable buddy description ("" when blank), or null if it's too long. It reaches the tutor's instructions as quoted
 * data, so markup and quote characters are removed and it is kept to one short line.
 */
export function cleanBuddyDescription(raw: string): string | null {
  const text = raw
    .normalize("NFC")
    .replace(/[\p{C}<>{}\[\]`\\]/gu, " ")
    .replace(/"/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= MAX_BUDDY_DESCRIPTION ? text : null;
}

export function isBuddyColor(c: unknown): c is BuddyColor {
  return typeof c === "string" && Object.hasOwn(BUDDY_COLORS, c);
}

export interface AppTile {
  id: string;
  name: string;
  /** A Lucide icon name, e.g. "book-open". */
  icon: string;
  /** A built-in drawing for the card ("books", "easel"…), or null to use the icon. */
  art?: string | null;
  description: string;
  /** studio: asking for a picture in the chat draws it (Picture Studio). quiz: the buddy's quizzes, to take. */
  kind?: "tutor" | "studio" | "quiz";
  live: boolean;
}

/** Server -> child device. */
export type ServerEvent =
  | {
      type: "ready";
      child: { id: string; name: string; parentTitle: string; subjects: SubjectOption[] };
      buddies: Buddy[];
      activeBuddyId: number | null;
      apps: AppTile[];
    }
  /**
   * The child's buddies or subjects changed (a buddy made, edited, removed or switched; a subject added). The chat for
   * the active buddy follows as items.
   */
  | { type: "buddies"; buddies: Buddy[]; activeBuddyId: number | null; subjects: SubjectOption[] }
  /** A buddy's files changed (added, read, removed). */
  | { type: "files"; buddyId: number; files: BuddyFile[] }
  /** A buddy's quizzes changed (one offered, made, taken or removed): fetch its list again. */
  | { type: "quizzes"; buddyId: number }
  /** What buddies have said on their own that the child hasn't seen yet, newest first. */
  | { type: "nudges"; nudges: Nudge[] }
  /** The child's apps changed (one added, removed, or turned on or off for them). */
  | { type: "apps"; apps: AppTile[] }
  /** All the child's reminders and plans that are proposed, active or paused. */
  | { type: "schedules"; schedules: Schedule[] }
  /** Chat events carry `app`: the app whose chat they belong to. A device showing another app's chat ignores them. */
  | { type: "items"; items: SequencedItem[]; reset: boolean; app?: string }
  | { type: "problem"; problem: ProblemView | null; app?: string }
  | { type: "thinking"; on: boolean; app?: string }
  /** Picture Studio: the buddy is painting `title` (on), or has finished (off). */
  | { type: "painting"; on: boolean; title?: string; app?: string }
  /** Quizzes: the buddy is writing a quiz about `topic` (on), or has finished (off). */
  | { type: "quizzing"; on: boolean; topic?: string; count?: number; app?: string }
  | { type: "reply_delta"; id: string; text: string; app?: string }
  | { type: "reply_end"; id: string; app?: string }
  | { type: "error"; message: string; app?: string }
  | { type: "revoked" };

/** Child device -> server. */
export type ClientEvent =
  | { type: "auth"; token: string }
  /** `buddyId` is the buddy whose chat the device is showing; if it isn't the active one, the server resends from scratch. */
  | { type: "sync"; since: number; buddyId: number | null; app?: string }
  /** `files`: ids of the buddy's files to share with this message. */
  | { type: "send"; app: string; text: string; files?: number[] }
  | { type: "create_buddy"; buddy: BuddyInput }
  | { type: "update_buddy"; id: number; buddy: BuddyInput }
  | { type: "switch_buddy"; id: number }
  | { type: "delete_buddy"; id: number }
  /** Change how a buddy looks: its colour and everything it's wearing now. */
  | { type: "dress_buddy"; id: number; color: BuddyColor; wear: Accessory[] }
  /** The child picked the kind of quiz the buddy offered to make. */
  | { type: "make_quiz"; id: number; style: QuizStyle }
  /** The child has seen what a buddy said on its own (they opened its chat). */
  | { type: "seen_nudges"; buddyId: number }
  /** A reminder the child set up themselves on the Reminders page, for their current buddy. */
  | { type: "add_schedule"; schedule: { kind: "reminder" | "task"; text: string; rule: ScheduleRule } }
  /** Confirm or turn down a proposed reminder, or pause, resume or delete one. */
  | { type: "schedule"; id: number; action: "confirm" | "cancel" | "pause" | "resume" | "delete" };

export interface SubjectOption {
  name: string;
  label: string;
}

// ---- Parent API shapes ----

export interface ParentSessionSummary {
  id: number;
  childId: string;
  childName: string;
  app: string;
  /** The buddy the child was talking to, if any. */
  buddy: Buddy | null;
  startedAt: string;
  endedAt: string | null;
  subjects: string[];
  problemsAttempted: number;
  problemsSolved: number;
  alerts: number;
  turns: number;
  /** From the start of the sitting to its last message. */
  minutes: number;
}

/** Totals over some sittings, for the parent's overview. */
export interface ParentStats {
  sessions: number;
  /** Sittings started in the last 7 days. */
  sessionsThisWeek: number;
  messages: number;
  problemsAttempted: number;
  problemsSolved: number;
  alerts: number;
  /** Drafts the leak check stopped before the child saw them. */
  blocked: number;
  /** Time from the start of each sitting to its last message, added up. */
  minutes: number;
  lastActiveAt: string | null;
}

export interface ParentBuddyOverview extends Buddy {
  stats: ParentStats;
}

export interface ParentChildOverview {
  id: string;
  name: string;
  age: number;
  year: string;
  mode: "strict" | "balanced" | "relaxed";
  stats: ParentStats;
  /** Model tokens used today against the daily budget. */
  usage: { today: number; budget: number };
  buddies: ParentBuddyOverview[];
}

/** A problem worked on in a sitting: how far up the hint ladder it went and whether it was solved. */
export interface ParentSessionProblem {
  label: string;
  subject: string | null;
  rung: Rung;
  attempts: number;
  solved: boolean;
}

export interface ParentTurn {
  id: number;
  role: "child" | "tutor";
  text: string;
  createdAt: string;
  intent: Record<string, unknown> | null;
  action: Record<string, unknown> | null;
  blocked: { text: string; reason: string }[];
  toolCalls: { tool: string; args: unknown; accepted: boolean; error: string | null }[];
  alerts: { severity: string; summary: string }[];
  /** Exactly what the child's device showed for this turn, in order. Empty for turns from before this was recorded. */
  items: ChatItem[];
}

export interface ParentAlert {
  id: number;
  childId: string;
  childName: string;
  turnId: number | null;
  sessionId: number | null;
  severity: string;
  summary: string;
  sentAt: string;
  readAt: string | null;
}

export interface ParentDevice {
  id: number;
  childId: string;
  name: string;
  pairedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}
