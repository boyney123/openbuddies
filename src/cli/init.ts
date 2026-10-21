import * as p from "@clack/prompts";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AgentHost } from "../server/agent.js";
import { hashPin, validPin } from "../server/auth.js";
import { DEFAULT_PORT, loadHousehold, RECOMMENDED_MODELS, SUGGESTED_MODELS, untestedModels, type Mode } from "../server/config.js";
import { writeHousehold, type ChildSpec } from "./scaffold.js";
import { installService, serviceInstalled, stopServer, uninstallService } from "./service.js";
import { setupTailscale } from "./tailscale.js";

/** Where to set a spending limit, for the providers offered first. */
const CONSOLES: Record<string, string> = {
  anthropic: "console.anthropic.com",
  openai: "platform.openai.com",
  google: "aistudio.google.com",
  openrouter: "openrouter.ai/settings",
};

function ask<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled. Nothing was written.");
    process.exit(1);
  }
  return value as Exclude<T, symbol>;
}


export async function askChild(n: number): Promise<ChildSpec> {
  p.log.step(n === 1 ? "Now tell me about your child." : `Child ${n}`);
  const name = ask(await p.text({ message: "Child's first name", validate: (v) => (v?.trim() ? undefined : "Enter a name") })).trim();
  const age = Number(
    ask(await p.text({ message: `${name}'s age`, placeholder: "12", validate: (v) => (/^\d{1,2}$/.test(v?.trim() ?? "") ? undefined : "Enter an age, e.g. 12") })),
  );
  const year = ask(await p.text({ message: "School year", placeholder: "Year 7", defaultValue: "", initialValue: "" })).trim();
  // Subjects come later: the child picks them for their study buddies, and you can set any subject differently on
  // the parent page. This is how much help they get everywhere else.
  const mode = ask(
    await p.select<Mode>({
      message: `How much help should OpenBuddies give ${name}?`,
      initialValue: "strict",
      options: [
        { value: "strict", label: "Strict", hint: "never gives answers, only questions, hints and similar examples" },
        { value: "balanced", label: "Balanced", hint: "shows the answer only after real effort" },
        { value: "relaxed", label: "Relaxed", hint: "explains freely" },
      ],
    }),
  );
  return { name, age, year, mode };
}

export async function runInit(opts: { home?: string }) {
  p.intro("OpenBuddies setup");
  p.note("A homework tutor that guides with questions and hints, never handing over answers.\nThis takes about two minutes.", "Welcome");

  // 1. Parent
  const parentName = ask(await p.text({ message: "Your name", validate: (v) => (v?.trim() ? undefined : "Enter your name") })).trim();
  const title = ask(await p.text({ message: "What does your child call you?", placeholder: "Dad", defaultValue: "Dad" })).trim() || "Dad";
  let pin = "";
  for (;;) {
    pin = ask(await p.password({ message: "Choose a parent PIN (4 to 8 digits)", validate: (v) => (validPin(v ?? "") ? undefined : "Use 4 to 8 digits") }));
    const again = ask(await p.password({ message: "Type the PIN again" }));
    if (again === pin) break;
    p.log.warn("Those PINs didn't match. Try again.");
  }
  const pinHash = await hashPin(pin);

  // 2. Provider and models
  const providers = await AgentHost.providers();
  let provider = ask(
    await p.select<string>({
      message: "Which AI provider?",
      options: [
        { value: "anthropic", label: "Anthropic (Claude)", hint: "recommended" },
        { value: "openai", label: "OpenAI", hint: "recommended" },
        { value: "google", label: "Google (Gemini)" },
        { value: "openrouter", label: "OpenRouter", hint: "one key for models from many companies" },
        { value: "other", label: "Another provider" },
      ],
    }),
  );
  if (provider === "other") {
    const others = providers.filter((x) => !(x.id in SUGGESTED_MODELS));
    provider = ask(await p.autocomplete<string>({ message: "Which provider? (type to search)", options: others.map((x) => ({ value: x.id, label: x.name })), maxItems: 8 }));
  }
  const providerName = providers.find((x) => x.id === provider)?.name ?? provider;
  const known = await AgentHost.knownModels(provider);
  const pickModel = async (message: string, suggested: string | undefined) =>
    ask(await p.autocomplete<string>({ message: `${message} (type to search)`, options: known.map((m) => ({ value: m, label: m, hint: RECOMMENDED_MODELS.has(m) ? "recommended" : undefined })), initialValue: suggested, maxItems: 8 }));
  const models = {
    tutor: await pickModel("Tutor model (does the talking)", SUGGESTED_MODELS[provider]?.tutor),
    check: await pickModel("Check model (small and fast: labels messages, checks for leaked answers)", SUGGESTED_MODELS[provider]?.check),
  };
  const untested = untestedModels(models);
  if (untested) p.log.warn(`${untested}\nThe safety checks depend on these models doing their job well.`);

  // 3. Key
  let apiKey = "";
  for (;;) {
    apiKey = ask(await p.password({ message: `${providerName} API key`, validate: (v) => (v?.trim() ? undefined : "Paste your API key") })).trim();
    const spin = p.spinner();
    spin.start("Checking the key with one small request");
    const res = await AgentHost.validateKey(models.check, apiKey);
    if (res.ok) {
      spin.stop("Key works");
      break;
    }
    spin.stop(`That key didn't work: ${res.error}`);
    const next = ask(
      await p.select({
        message: "What now?",
        options: [
          { value: "retry", label: "Enter the key again" },
          { value: "keep", label: "Keep it anyway (I'm offline right now)" },
        ],
      }),
    );
    if (next === "keep") break;
  }

  // 4 and 5. First child
  const children: ChildSpec[] = [await askChild(1)];

  // 6. More children
  while (ask(await p.confirm({ message: "Add another child?", initialValue: false }))) children.push(await askChild(children.length + 1));

  // 7. The household folder: ~/openbuddies, or wherever --home says. Not asked: one less thing to get wrong.
  const dir = resolve(opts.home ?? join(homedir(), "openbuddies"));
  if (existsSync(join(dir, "openbuddies.yaml"))) {
    const overwrite = ask(await p.confirm({ message: `OpenBuddies is already set up in ${dir}. Replace its settings? (Chats and history are kept.)`, initialValue: false }));
    if (!overwrite) {
      p.cancel("Nothing was changed.");
      process.exit(1);
    }
  }

  const spin = p.spinner();
  // A server still running this folder's old setup would keep the old PIN and database: stop it first.
  if (existsSync(join(dir, "openbuddies.yaml"))) {
    spin.start("Stopping the OpenBuddies already running for this folder");
    let port = DEFAULT_PORT;
    try {
      port = loadHousehold(dir).config.port;
    } catch {}
    await stopServer(dir, port);
    spin.stop("Stopped the old OpenBuddies");
  }
  spin.start("Writing your household folder");
  const ids = writeHousehold({ dir, parent: { name: parentName, title, pinHash }, models, keys: { [provider]: apiKey }, children });
  if (dir !== join(homedir(), "openbuddies")) writeFileSync(join(homedir(), ".openbuddiesrc"), dir + "\n");
  spin.stop(`Wrote ${dir}`);

  const autostart = ask(await p.confirm({ message: "Start OpenBuddies automatically when this computer starts?", initialValue: true }));
  if (!autostart && serviceInstalled(dir)) {
    uninstallService();
    p.log.info("Removed the background service from this folder's previous setup.");
  }
  if (autostart) {
    try {
      const res = installService(dir);
      p.log.success(res.kind === "none" ? "No service manager here." : `Installed a ${res.kind} service. OpenBuddies is running.`);
      if (res.note) p.log.info(res.note);
    } catch (e) {
      p.log.warn(`Couldn't install the service: ${(e as Error).message}. Use \`openbuddies start\` instead.`);
    }
  }

  // Tailscale needs the server's port, which is known now. Serve can be set up before the server runs.
  p.log.step("Remote access");
  const ts = await setupTailscale(DEFAULT_PORT, { childNames: children.map((c) => c.name), fromInit: true });

  p.note(
    [
      `Children: ${ids.join(", ")}`,
      ts.serving ? `OpenBuddies address: https://${ts.dnsName}` : "OpenBuddies works on your home Wi-Fi. Run `openbuddies tailscale` any time to reach it from anywhere.",
      "",
      "Before your child uses it:",
      `1. Set a monthly spending limit in your ${providerName} account${CONSOLES[provider] ? ` (${CONSOLES[provider]})` : ""}.`,
      `2. Read ${providerName}'s usage policy for products used by under-18s.`,
      "",
      `Your household: ${tilde(dir)}`,
      "  Settings, chats and files. Copy this folder to back everything up.",
      "",
      "Handy commands:",
      "  openbuddies start          open the parent page and show the codes to scan",
      "  openbuddies pair <child>   pair another phone or tablet",
      "  openbuddies update         move to the newest version",
      "  openbuddies stop           stop OpenBuddies",
    ].join("\n"),
    "All set",
  );
  p.outro("Starting OpenBuddies…");

  // Finish where the parent wants to be: OpenBuddies running, the parent page open and a code to scan. A fresh CLI
  // process runs `start`, as if typed, so it finds the server the service just started.
  spawnSync(process.execPath, [...process.execArgv, process.argv[1], "start", "--home", dir], { stdio: "inherit" });
}

const tilde = (path: string) => (path.startsWith(homedir() + "/") ? `~${path.slice(homedir().length)}` : path);
