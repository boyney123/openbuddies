// A buddy's files: homework photos and notes a child keeps with a buddy so it can refer to them later.
// The bytes live in data/files/<child>/<buddy>/ under the household folder; buddy_files in the database says what each
// one is. A photo is transcribed once, by the check model, when it's added: that text is what the classifier and the
// answer-leak check read. The tutor sees the photo itself when the child shares it (agent.ts).

import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FILE_LIMITS, type FileKind } from "../shared/protocol.js";
import type { StructuredCaller } from "./classifier.js";
import { fenceMaterial, FILE_READER_SCHEMA, FILE_READER_SYSTEM, sanitiseChildText } from "./prompts.js";

export interface DetectedFile {
  kind: FileKind;
  mime: string;
  ext: string;
}

const startsWith = (buf: Buffer, bytes: number[], at = 0) => bytes.every((b, i) => buf[at + i] === b);

/**
 * What a file really is, from its first bytes (never the name or the browser's word for it). Only pictures a phone
 * camera makes and plain text are allowed; anything else is refused.
 */
export function detectFile(buf: Buffer, name: string): DetectedFile | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "image", mime: "image/png", ext: "png" };
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { kind: "image", mime: "image/webp", ext: "webp" };
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return { kind: "image", mime: "image/gif", ext: "gif" };
  if (/\.(txt|md|markdown)$/i.test(name) && isPlainText(buf)) return { kind: "text", mime: "text/plain; charset=utf-8", ext: "txt" };
  return null;
}

/** Valid UTF-8 with no control characters other than tabs and line breaks. */
function isPlainText(buf: Buffer): boolean {
  try {
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(new TextDecoder("utf-8", { fatal: true }).decode(buf));
  } catch {
    return false;
  }
}

/** A safe display name: no folders, no control characters, not too long. */
export function cleanFileName(raw: string, ext: string): string {
  const base = raw
    .split(/[\\/]/)
    .pop()!
    .normalize("NFC")
    .replace(/[\p{C}<>"]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const name = base || `file.${ext}`;
  return name.length > FILE_LIMITS.nameLength ? `${name.slice(0, FILE_LIMITS.nameLength - ext.length - 2)}….${ext}` : name;
}

/** Save the bytes under data/files/ with a random name. Returns the path relative to the household folder. */
export function storeFile(home: string, childId: string, buddyId: number, buf: Buffer, ext: string): string {
  const rel = join("data", "files", childId, String(buddyId), `${randomBytes(12).toString("hex")}.${ext}`);
  const full = join(home, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, buf, { mode: 0o600 });
  return rel;
}

export function removeStoredFile(home: string, rel: string) {
  const full = join(home, rel);
  // Only ever delete inside data/files/.
  if (full.startsWith(join(home, "data", "files"))) rmSync(full, { force: true });
}

const MAX_TEXT = 12_000;

/** Read a text file for the buddy. */
export function readTextFile(buf: Buffer): { text: string; summary: string } {
  const text = sanitiseChildText(buf.toString("utf8")).slice(0, MAX_TEXT);
  const first = text.split("\n").find((l) => l.trim()) ?? "";
  return { text, summary: first.trim().slice(0, 80) || "A text file" };
}

/** Transcribe a photo with the check model. Null text means it couldn't be read. */
export async function readImage(caller: StructuredCaller, buf: Buffer, mime: string): Promise<{ text: string | null; summary: string | null; tokens: number }> {
  const res = await caller.completeStructured<{ text?: string; summary?: string }>({
    system: FILE_READER_SYSTEM,
    user: "Transcribe this photo.",
    images: [{ data: buf.toString("base64"), mimeType: mime }],
    toolName: "photo_transcript",
    description: "Record what the photo says",
    schema: FILE_READER_SCHEMA,
    model: "check",
    maxTokens: 2000,
  });
  const text = typeof res.value?.text === "string" ? sanitiseChildText(res.value.text).slice(0, MAX_TEXT).trim() : "";
  const summary = typeof res.value?.summary === "string" ? res.value.summary.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  return { text: text || null, summary: summary || null, tokens: res.tokens };
}

const added = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/**
 * The buddy's files as a short list for every turn: names, one-line summaries and when each was added, so the buddy
 * knows what the child has kept with it. A file's content reaches the buddy when the child shares it or mentions it
 * (see fileMarker and fileCandidates). Null when the buddy has no files.
 */
export function buildCatalogue(files: { id: number; name: string; summary: string | null; status: string; createdAt: string }[], fenceId: string): string | null {
  const usable = files.filter((f) => f.status === "ready");
  if (!usable.length) return null;
  const lines = usable.slice(0, 20).map((f) => `- ${f.name}${f.summary ? `: ${f.summary}` : ""} (added ${added(f.createdAt)})`);
  if (usable.length > 20) lines.push(`- and ${usable.length - 20} more`);
  return fenceMaterial(
    fenceId,
    "Files the child keeps with you. When they mention one, it's found and shown to you with their message. If you need one you can't see, ask them to share it with the paperclip.",
    lines.join("\n"),
  );
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

/**
 * Which of a buddy's files to offer the classifier for a message, at most `max`: the ones sharing the most words with
 * it first, then the newest. Keeps the classifier's prompt short however many files the buddy has. Pure and cheap: no
 * model call, no file reads.
 */
export function fileCandidates<T extends { name: string; summary: string | null; createdAt: string }>(files: T[], text: string, max = 40): T[] {
  if (files.length <= max) return files;
  const asked = words(text);
  const score = (f: T) => [...words(`${f.name} ${f.summary ?? ""}`)].filter((w) => asked.has(w)).length;
  return [...files].sort((a, b) => score(b) - score(a) || Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, max);
}

// Shared files are recorded in the saved conversation as markers like "[file #12: sheet.jpg]". The bytes are loaded
// from disk each time the conversation goes to the model (agent.ts), so they're never copied into session files, and
// a file the parent removes is gone from what the buddy sees.
const MARKER = /\[file #(\d+): [^\]\n]{0,120}\]/g;

export const fileMarker = (f: { id: number; name: string }) => `[file #${f.id}: ${f.name.replace(/[[\]\n]/g, "")}]`;

/** The file ids marked in some text, in order. */
export function markedFileIds(text: string): number[] {
  return [...text.matchAll(MARKER)].map((m) => Number(m[1]));
}

/** Remove markers a child typed themselves: only the server adds them. */
export function stripFileMarkers(text: string): string {
  return text.replace(MARKER, "").trim();
}

/** A shared text file as the buddy reads it, fenced as the child's material. */
export function quotedTextFile(name: string, text: string, fenceId: string): string {
  return fenceMaterial(fenceId, `The child shared ${name}:`, text.slice(0, 6000));
}
