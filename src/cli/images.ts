// `openbuddies images`: set up Picture Studio's image model (src/server/pictures.ts): OpenAI or Google, whichever key is
// in the household .env (OpenAI first, like web search). The key sits next to the tutor's key, readable only by you.

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import type { Household } from "../server/config.js";
import { generateImage, imageProviders, picturePrompt } from "../server/pictures.js";

const ENV = { openai: "OPENAI_API_KEY", google: "GEMINI_API_KEY" } as const;

function setEnv(dir: string, name: string, value: string) {
  const path = join(dir, ".env");
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith(`${name}=`)) : [];
  writeFileSync(path, [...lines, `${name}=${value}`].join("\n") + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function imagesStatus(h: Household) {
  const [first] = imageProviders(h.images);
  console.log(first ? `Picture Studio draws with ${first === "openai" ? "OpenAI" : "Google"}${h.images.model ? ` (${h.images.model})` : ""}.` : "Picture Studio: no image model set up. Run `openbuddies images setup`.");
  for (const c of h.children.values()) console.log(`  ${c.profile.name}: up to ${c.rules.pictures.daily} pictures a day`);
}

export async function imagesSetup(h: Household, opts: { provider?: string; key?: string; test?: boolean }) {
  let provider = opts.provider as keyof typeof ENV | undefined;
  let key = opts.key;
  if (!provider || !key) {
    if (!process.stdin.isTTY) {
      console.error("Pass --provider openai|google and --key <key>.");
      process.exit(1);
    }
    p.intro("Pictures for Picture Studio");
    p.note(
      "Children plan a picture with their buddy and tap Make it. OpenBuddies checks the idea is right for a child, then an\nimage model draws it. Each picture costs a few pence on that provider's bill; each child has a daily limit (6).\n\nOpenAI: gpt-image, with OpenAI's safety filter (an OpenAI API key).\nGoogle: Imagen, with people turned off (a Gemini API key).",
    );
    const picked = await p.select({ message: "Which image model?", options: [{ value: "openai", label: "OpenAI" }, { value: "google", label: "Google Imagen" }] });
    if (p.isCancel(picked)) process.exit(0);
    provider = picked as keyof typeof ENV;
    const entered = await p.password({ message: `${provider === "openai" ? "OpenAI" : "Gemini"} API key`, validate: (v) => (v?.trim() ? undefined : "Enter the key") });
    if (p.isCancel(entered)) process.exit(0);
    key = String(entered).trim();
  }
  if (!(provider in ENV)) {
    console.error("The provider must be openai or google.");
    process.exit(1);
  }
  if (opts.test) {
    console.log("Drawing a test picture (this costs a few pence)…");
    try {
      const img = await generateImage({ [provider]: key, provider }, picturePrompt("A smiling sun over a green hill."));
      console.log(`It worked (${Math.round(img.data.length / 1024)} KB).`);
    } catch (e) {
      console.error(`That didn't work: ${(e as Error).message}\nNothing saved.`);
      process.exit(1);
    }
  }
  setEnv(h.dir, ENV[provider], key);
  console.log(`Saved to ${join(h.dir, ".env")}. Picture Studio is on for every child unless you turn it off (openbuddies apps off <child> picture-studio).`);
}
