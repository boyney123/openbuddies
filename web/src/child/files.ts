// The child's files on the device: list, upload, show and remove a buddy's files over HTTP, using the device token.

import { FILE_LIMITS, isAutoFileName, type BuddyFile, type QuizAnswerResult, type QuizQuestionView, type QuizReview, type QuizStyle, type QuizSummary } from "../../../src/shared/protocol";
import { readToken } from "./useTutorSocket";

export async function childFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`/api/child${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${readToken() ?? ""}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Something went wrong. Try again.");
  return res;
}

export async function listFiles(buddyId: number): Promise<BuddyFile[]> {
  return (await childFetch(`/buddies/${buddyId}/files`)).json();
}

const MAX_SIDE = 1600;

/** A photo as something a canvas can draw: createImageBitmap where it works, else an <img> (older Safari). */
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Photos are redrawn at no more than 1600px before upload: sharp enough to read a worksheet, small enough to send
 * quickly and to cost few tokens when the buddy looks at it, and redrawing drops the photo's metadata (like where it
 * was taken). A phone camera's photo is often over the 8 MB limit as it is, so this matters.
 */
/** A photo's name: its own if a person chose it, else when it was taken, e.g. "Photo 21 Oct 4.05pm.jpg". */
function photoName(original: string): string {
  if (original && !isAutoFileName(original)) return original.replace(/\.[^.]+$/, "") + ".jpg";
  const d = new Date();
  const time = d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s/g, "").replace(":", ".").toLowerCase();
  return `Photo ${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" })} ${time}.jpg`;
}

async function shrink(file: File): Promise<{ body: Blob; name: string }> {
  try {
    const { source, width, height } = await decode(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (blob) return { body: blob, name: photoName(file.name) };
  } catch {}
  return { body: file, name: file.type.startsWith("image/") ? photoName(file.name).replace(/\.jpg$/, (file.name.match(/\.[^.]+$/) ?? [".jpg"])[0]) : file.name };
}

/** Add a photo or text file to a buddy. Photos come back "reading" until the buddy has read them. */
export async function uploadFile(buddyId: number, file: File): Promise<BuddyFile> {
  const { body, name } = file.type.startsWith("image/") || !file.type ? await shrink(file) : { body: file, name: file.name };
  if (body.size > FILE_LIMITS.maxBytes) throw new Error(`That ${file.type.startsWith("image/") ? "photo" : "file"} is too big. Try a smaller one.`);
  const res = await childFetch(`/buddies/${buddyId}/files?name=${encodeURIComponent(name || "photo.jpg")}`, { method: "POST", body });
  return res.json();
}

/** What the buddy remembers about earlier chats, or null text if nothing yet. */
export async function getMemory(buddyId: number): Promise<{ text: string | null; updatedAt?: string }> {
  return (await childFetch(`/buddies/${buddyId}/memory`)).json();
}

export async function clearMemory(buddyId: number): Promise<void> {
  await childFetch(`/buddies/${buddyId}/memory`, { method: "DELETE" });
}

export async function renameFile(id: number, name: string): Promise<BuddyFile> {
  return (await childFetch(`/files/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })).json();
}

/** A text file's contents, to read it on the device. */
export async function fileText(id: number): Promise<string> {
  return (await childFetch(`/files/${id}`)).text();
}

export async function deleteFile(id: number): Promise<void> {
  await childFetch(`/files/${id}`, { method: "DELETE" });
}

const urls = new Map<number, Promise<string | null>>();

/** A URL for showing a file on this device (fetched once, with the device token). */
export function fileUrl(id: number): Promise<string | null> {
  if (!urls.has(id)) {
    urls.set(
      id,
      childFetch(`/files/${id}`)
        .then((r) => r.blob())
        .then((b) => URL.createObjectURL(b))
        .catch(() => (urls.delete(id), null)),
    );
  }
  return urls.get(id)!;
}

/** What the file pickers accept. */
export const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.txt,.md,text/plain";

// ---- quizzes (the device only ever gets questions; answers are checked by the server) ----

export async function listQuizzes(buddyId: number): Promise<QuizSummary[]> {
  return (await childFetch(`/buddies/${buddyId}/quizzes`)).json();
}

export async function startQuiz(id: number): Promise<{ attemptId: number; title: string; style: QuizStyle; questions: QuizQuestionView[] }> {
  return (await childFetch(`/quizzes/${id}/attempts`, { method: "POST" })).json();
}

export async function answerQuiz(attemptId: number, n: number, answer: string): Promise<QuizAnswerResult> {
  return (await childFetch(`/attempts/${attemptId}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n, answer }) })).json();
}

export async function finishQuiz(attemptId: number): Promise<QuizReview> {
  return (await childFetch(`/attempts/${attemptId}/finish`, { method: "POST" })).json();
}

export async function deleteQuiz(id: number): Promise<void> {
  await childFetch(`/quizzes/${id}`, { method: "DELETE" });
}
