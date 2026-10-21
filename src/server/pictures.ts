// Picture Studio: a child asks their buddy for a picture in the chat ("I want a picture of a hotdog") and it's drawn;
// "add a dog to it" changes the last one. Before each reply, the check model reads the chat and decides: draw (a new
// picture, or a change to the last one), just chat (planning ideas), or decline kindly (anything that isn't right for a
// child). An image model draws it; the picture is kept in the buddy's files and shown in the chat. There's no tool for
// the tutor: the server decides and draws.
//
// Image providers, like web search: the first one set up in the household .env of OpenAI (OPENAI_API_KEY) or Google
// (GEMINI_API_KEY). IMAGE_PROVIDER picks one, IMAGE_MODEL a model. With OpenAI a change is made to the last picture
// itself, so it stays the same picture; Google redraws it from the updated description. Each picture counts against
// the child's daily picture limit (rules.yaml pictures.daily).

import type { StructuredCaller } from "./classifier.js";
import { PICTURE_SCHEMA, PICTURE_SYSTEM, sanitiseChildText } from "./prompts.js";

export interface ImageConfig {
  openai?: string;
  google?: string;
  provider?: "openai" | "google";
  model?: string;
}

export type ImageProvider = "openai" | "google";

export function imageProviders(cfg: ImageConfig): ImageProvider[] {
  const all: ImageProvider[] = [...(cfg.openai ? (["openai"] as const) : []), ...(cfg.google ? (["google"] as const) : [])];
  return cfg.provider ? all.filter((p) => p === cfg.provider) : all;
}

/** Every picture is asked for like this, whatever the child planned. */
export const picturePrompt = (plan: string) =>
  `A colourful, child-friendly illustration. ${plan} No text, letters or logos in the picture. No real people.`;

/**
 * Draw a picture, or change `base` (the last picture) when given and the provider can. Throws with a message for the
 * log when the provider refuses or fails.
 */
export async function generateImage(cfg: ImageConfig, prompt: string, base?: { data: Buffer; mime: string }): Promise<{ data: Buffer; mime: string }> {
  const order = imageProviders(cfg);
  if (!order.length) throw new Error("no image provider set up");
  let first: Error | null = null;
  for (const p of order) {
    try {
      if (p === "openai" && base) {
        const form = new FormData();
        form.append("model", cfg.model ?? "gpt-image-1");
        form.append("prompt", prompt);
        form.append("size", "1024x1024");
        form.append("image", new Blob([new Uint8Array(base.data)], { type: base.mime }), base.mime === "image/jpeg" ? "picture.jpg" : "picture.png");
        const res = await fetch("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.openai}` },
          body: form,
          signal: AbortSignal.timeout(120_000),
        });
        const body: any = await res.json().catch(() => ({}));
        if (!res.ok || !body?.data?.[0]?.b64_json) throw new Error(`openai edit ${res.status}: ${String(body?.error?.message ?? "no image").slice(0, 160)}`);
        return { data: Buffer.from(body.data[0].b64_json, "base64"), mime: "image/png" };
      }
      if (p === "openai") {
        const res = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.openai}` },
          body: JSON.stringify({ model: cfg.model ?? "gpt-image-1", prompt, size: "1024x1024", n: 1, quality: "medium", moderation: "auto" }),
          signal: AbortSignal.timeout(120_000),
        });
        const body: any = await res.json().catch(() => ({}));
        if (!res.ok || !body?.data?.[0]?.b64_json) throw new Error(`openai ${res.status}: ${String(body?.error?.message ?? "no image").slice(0, 160)}`);
        return { data: Buffer.from(body.data[0].b64_json, "base64"), mime: "image/png" };
      }
      const model = cfg.model ?? "imagen-4.0-generate-001";
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.google! },
        body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: "1:1", personGeneration: "dont_allow" } }),
        signal: AbortSignal.timeout(120_000),
      });
      const body: any = await res.json().catch(() => ({}));
      const out = body?.predictions?.[0];
      if (!res.ok || !out?.bytesBase64Encoded) throw new Error(`google ${res.status}: ${String(body?.error?.message ?? "no image").slice(0, 160)}`);
      return { data: Buffer.from(out.bytesBase64Encoded, "base64"), mime: out.mimeType ?? "image/png" };
    } catch (e) {
      first ??= e as Error;
    }
  }
  throw first!;
}

export interface PicturePlan {
  /** draw: make a picture now (new, or a change to the last). chat: just reply. decline: `say` kindly suggests something else. */
  action: "draw" | "chat" | "decline";
  /** Drawing a change to the last picture. */
  edit: boolean;
  title: string;
  /** The whole picture as it should now look (for a change: the last one with the change). */
  prompt: string;
  /** What the buddy says first, e.g. "Ooh, a hotdog! Painting it now…". */
  say: string;
  tokens: number;
}

/** Read the chat (with this message last) and decide whether to draw, chat or decline. */
export async function planPicture(
  caller: StructuredCaller,
  conversation: { role: "child" | "tutor"; text: string }[],
  last: { title: string; prompt: string } | null,
): Promise<PicturePlan> {
  const chat = conversation
    .slice(-16)
    .map((t) => `${t.role === "child" ? "Child" : "Buddy"}: ${sanitiseChildText(t.text).slice(0, 600)}`)
    .join("\n");
  const res = await caller.completeStructured<{ action?: string; edit?: boolean; title?: string; prompt?: string; say?: string }>({
    system: PICTURE_SYSTEM,
    user: `${last ? `The last picture made, "${last.title}", shows: ${last.prompt}\n\n` : "No picture has been made yet.\n\n"}The chat so far (the last message is the child's newest):\n"""\n${chat}\n"""`,
    toolName: "picture_request",
    description: "Record whether to draw, and what",
    schema: PICTURE_SCHEMA,
    model: "check",
    maxTokens: 500,
  });
  const v = res.value ?? {};
  const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");
  const prompt = clean(v.prompt, 600);
  const action = v.action === "decline" ? "decline" : v.action === "draw" && prompt.length > 10 ? "draw" : "chat";
  return {
    action,
    edit: action === "draw" && v.edit === true && !!last,
    title: clean(v.title, 50) || last?.title || "My picture",
    prompt,
    say: clean(v.say, 300) || (action === "decline" ? "Let's try a different idea for this one. What else could we make?" : "Here it comes!"),
    tokens: res.tokens,
  };
}
