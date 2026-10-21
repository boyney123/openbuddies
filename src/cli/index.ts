#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import open from "open";
import qrcode from "qrcode-terminal";
import { allowanceFor, loadHousehold, normaliseSubject, resolveHome, untestedModels, type Household, type Mode } from "../server/config.js";
import { listSubjects, removeSubject, setAllowance, setDefaultMode, setSubject, setWeb } from "../server/subjects.js";
import { webSetup, webStatus, webTest } from "./web.js";
import { imagesSetup, imagesStatus } from "./images.js";
import { appsAdd, appsGallery, appsList, appsRemove, appsSwitch } from "./apps.js";
import { writeChild, type ChildSpec } from "../server/children.js";
import { Db } from "../server/db.js";
import { childBaseUrl, tailscaleStatus } from "../server/network.js";
import { codeVersion, householdId, packageRoot } from "../server/paths.js";
import { runningServer, serverLogPath, serviceInstalled, serviceKind, staleReason, startBackground, stopServer } from "./service.js";

const program = new Command();
program
  .name("openbuddies")
  .description("Self-hosted AI study buddies for families: they guide with questions and hints, never handing over answers.")
  .version(JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8")).version)
  .option("--home <dir>", "household folder (default ~/openbuddies)");

const home = () => resolveHome(program.opts().home);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function household(): Household {
  try {
    return loadHousehold(home());
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

async function healthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function printPairing(h: Household, db: Db, childId: string) {
  const child = h.children.get(childId)!;
  const token = db.createPairingToken(childId);
  const url = `${(await childBaseUrl(h.config.port)).base}/pair?token=${token}`;
  console.log(`\n  Pair a device for ${child.profile.name}: scan with the phone's camera (expires in 10 minutes)\n`);
  qrcode.generate(url, { small: true }, (q) => console.log(q.replace(/^/gm, "  ")));
  console.log(`  ${url}\n`);
}

program
  .command("init")
  .description("set up a household: parent, provider, children")
  .action(async () => {
    const { runInit } = await import("./init.js");
    await runInit({ home: program.opts().home });
  });

program
  .command("serve", { hidden: true })
  .description("run the server in the foreground (used by the background service)")
  .action(async () => {
    const { startServer } = await import("../server/index.js");
    try {
      const server = await startServer({ home: home() });
      const stop = async () => {
        await server.close();
        process.exit(0);
      };
      process.on("SIGTERM", stop);
      process.on("SIGINT", stop);
    } catch (e) {
      console.error(`OpenBuddies could not start: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("start")
  .description("start OpenBuddies, print the URLs and pairing QR codes, open the parent page")
  .option("--no-open", "don't open the browser")
  .option("--no-qr", "don't print pairing QR codes")
  .action(async (opts) => {
    const h = household();
    const port = h.config.port;
    const running = await runningServer(port);
    const stale = running && staleReason(running, h.dir, { householdId: householdId(h.dir), code: codeVersion() });
    if (running && stale) {
      if (running.home && resolve(running.home) !== resolve(h.dir)) {
        console.error(`Port ${port} is in use by another OpenBuddies household (${running.home}). Stop it with: openbuddies stop --home "${running.home}"`);
        process.exit(1);
      }
      console.log(`Restarting OpenBuddies: ${stale}.`);
      if (!(await stopServer(h.dir, port))) {
        console.error(`Couldn't stop the server on port ${port}. Stop it yourself (it may be a process started in another terminal), then run openbuddies start again.`);
        process.exit(1);
      }
    }
    if (running && !stale) {
      console.log("OpenBuddies is already running.");
    } else {
      const how = startBackground(h.dir);
      process.stdout.write(`Starting OpenBuddies (${how === "service" ? `${serviceKind()} service` : "background process"})`);
      let up = false;
      for (let i = 0; i < 60 && !up; i++) {
        await sleep(500);
        process.stdout.write(".");
        up = await healthy(port);
      }
      console.log("");
      if (!up) {
        console.error(`OpenBuddies didn't come up. Last lines of ${serverLogPath(h.dir)}:\n`);
        if (existsSync(serverLogPath(h.dir))) console.error(readFileSync(serverLogPath(h.dir), "utf8").split("\n").slice(-15).join("\n"));
        process.exit(1);
      }
    }
    const { base, via } = await childBaseUrl(port);
    const parentUrl = `http://localhost:${port}/parent`;
    console.log(`\n  Parent page:  ${parentUrl}${via.startsWith("tailscale") ? `  (or ${base}/parent from your phone)` : ""}`);
    const how = { "tailscale-https": "Tailscale, HTTPS", tailscale: "Tailscale", lan: "home Wi-Fi only", localhost: "this computer only" }[via];
    console.log(`  Child app:    ${base}/  (${how})`);
    if (via === "lan" || via === "localhost") console.log("  Tip: run `openbuddies tailscale` so phones work away from home Wi-Fi and OpenBuddies installs like an app.");
    if (via === "tailscale") console.log("  Tip: run `openbuddies tailscale` to turn on HTTPS so OpenBuddies installs like an app.");
    if (opts.qr) {
      const db = new Db(join(h.dir, "data", "openbuddies.db"));
      for (const id of h.children.keys()) await printPairing(h, db, id);
      db.close();
    }
    if (opts.open) await open(parentUrl).catch(() => {});
  });

program
  .command("stop")
  .description("stop OpenBuddies")
  .action(async () => {
    const h = household();
    const wasRunning = await healthy(h.config.port);
    const stopped = await stopServer(h.dir, h.config.port);
    console.log(!stopped ? "OpenBuddies is still running (it may belong to another household, or was started some other way)." : wasRunning ? "OpenBuddies stopped." : "OpenBuddies wasn't running.");
  });

program
  .command("status")
  .description("show whether OpenBuddies is running")
  .option("--check", "self-test: list each session's tools and fail if anything beyond the six tutor tools is present")
  .action(async (opts) => {
    const h = household();
    const running = await runningServer(h.config.port);
    const stale = running && staleReason(running, h.dir, { householdId: householdId(h.dir), code: codeVersion() });
    console.log(`Household: ${h.dir}`);
    console.log(`Server:    ${!running ? "not running" : stale ? `running on port ${h.config.port}, but ${stale}. Run \`openbuddies start\` to restart it.` : `running on port ${h.config.port}`}`);
    console.log(`Service:   ${serviceInstalled(h.dir) ? `${serviceKind()} installed` : serviceInstalled() ? "installed for another household" : "not installed"}`);
    console.log(`Models:    tutor ${h.config.models.tutor}, checks ${h.config.models.check}`);
    const untested = untestedModels(h.config.models);
    if (untested) console.log(`Warning:   ${untested}`);
    console.log(`Children:  ${[...h.children.values()].map((c) => `${c.profile.name} (${c.profile.id})`).join(", ") || "none"}`);
    console.log(`Apps:      ${[...h.apps.keys()].join(", ") || "none"}`);
    for (const e of h.errors) console.log(`Problem:   ${e}`);
    if (opts.check) {
      const { AgentHost } = await import("../server/agent.js");
      const { checkSessionTools } = await import("../server/index.js");
      const agent = await AgentHost.create(h);
      const res = await checkSessionTools(agent, h);
      agent.dispose();
      console.log("\nSession tools self-test:");
      for (const line of res.report) console.log(`  ${line}`);
      console.log(res.ok ? "\nPASS: only the six tutor tools are present." : "\nFAIL: unexpected tools present.");
      if (!res.ok) process.exit(1);
    }
  });

program
  .command("pair <child>")
  .description("print a fresh QR code to pair another device for a child")
  .action(async (childId: string) => {
    const h = household();
    if (!h.children.has(childId)) {
      console.error(`No child "${childId}". Children: ${[...h.children.keys()].join(", ")}`);
      process.exit(1);
    }
    if (!(await healthy(h.config.port))) console.warn("Note: OpenBuddies isn't running. Run `openbuddies start` before scanning.");
    const db = new Db(join(h.dir, "data", "openbuddies.db"));
    await printPairing(h, db, childId);
    db.close();
  });

program
  .command("logs <child>")
  .description("tail a child's transcripts in the terminal")
  .option("-n, --lines <n>", "how many past turns to show", "20")
  .action(async (childId: string, opts) => {
    const h = household();
    if (!h.children.has(childId)) {
      console.error(`No child "${childId}". Children: ${[...h.children.keys()].join(", ")}`);
      process.exit(1);
    }
    const db = new Db(join(h.dir, "data", "openbuddies.db"));
    const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
    const print = (t: any) => {
      const time = new Date(t.created_at).toLocaleTimeString();
      const who = t.role === "child" ? `\x1b[36m${h.children.get(childId)!.profile.name}\x1b[0m` : "\x1b[35mTutor\x1b[0m";
      console.log(`${dim(time)} ${who}: ${t.text}`);
      const intent = t.intent_json && JSON.parse(t.intent_json);
      const action = t.action_json && JSON.parse(t.action_json);
      const tags = [
        intent && `${intent.intent}`,
        intent && intent.pressure !== "none" && `pressure:${intent.pressure}`,
        intent && intent.welfare !== "fine" && `\x1b[31mwelfare:${intent.welfare}\x1b[0m`,
        t.role === "child" && action && `→ ${action.kind}${action.rung ? `@${action.rung}` : ""}`,
        t.blocked && `\x1b[31m${t.blocked} blocked draft(s)\x1b[0m`,
      ].filter(Boolean);
      if (tags.length) console.log(dim(`         [${tags.join(" · ")}]`));
    };
    const recent = db.sql
      .prepare("SELECT t.id FROM turns t JOIN sessions s ON s.id = t.session_id WHERE s.child_id = ? ORDER BY t.id DESC LIMIT 1 OFFSET ?")
      .pluck()
      .get(childId, Math.max(0, Number(opts.lines))) as number | undefined;
    let last = recent ?? 0;
    for (;;) {
      for (const t of db.turnsAfter(childId, last)) {
        print(t);
        last = t.id;
      }
      await sleep(1000);
    }
  });

program
  .command("tailscale [action]")
  .description("set up Tailscale for phones away from home and HTTPS (action: setup, status, off)")
  .action(async (action = "setup") => {
    const h = household();
    const port = h.config.port;
    if (action === "status") {
      const st = await tailscaleStatus(port);
      console.log(`Installed: ${st.installed ? "yes" : "no"}`);
      console.log(`Signed in: ${st.running ? `yes (${st.dnsName ?? st.ip})` : "no"}`);
      console.log(`Serve:     ${st.serving ? `on: https://${st.dnsName}` : "off"}`);
      return;
    }
    const { setupTailscale, tailscaleOff } = await import("./tailscale.js");
    if (action === "off") {
      console.log((await tailscaleOff(port)) ? "Tailscale Serve is off. OpenBuddies is still reachable on home Wi-Fi." : "Nothing to turn off.");
      return;
    }
    if (action !== "setup") {
      console.error(`Unknown action "${action}". Use setup, status or off.`);
      process.exit(1);
    }
    const p = await import("@clack/prompts");
    p.intro("Tailscale for OpenBuddies");
    const st = await setupTailscale(port, { childNames: [...h.children.values()].map((c) => c.profile.name) });
    p.outro(st.serving ? "Done. Pair devices again with `openbuddies pair <child>` to use the HTTPS address." : "Tailscale isn't fully set up. OpenBuddies still works on home Wi-Fi.");
  });

program
  .command("reset")
  .description("reset OpenBuddies to a fresh install: deletes settings, children and history (asks first, offers a backup)")
  .option("-y, --yes", "don't ask (still keeps a backup unless --no-backup)")
  .option("--no-backup", "don't keep a backup copy")
  .action(async (opts) => {
    const { runReset } = await import("./reset.js");
    await runReset(home(), { yes: opts.yes, backup: opts.backup });
  });

program
  .command("update")
  .description("update OpenBuddies to the latest version: keeps a copy of your household first, and goes back if the new version doesn't start")
  .option("-y, --yes", "don't ask")
  .option("--to <version>", "update (or go back) to this version instead of the latest")
  .option("--no-backup", "don't keep a copy of the household first")
  .action(async (opts) => {
    const { runUpdate } = await import("./update.js");
    await runUpdate(home(), { yes: opts.yes, to: opts.to, backup: opts.backup });
  });

const children = program.command("children").description("list or add children, or change how much help one gets");

children
  .command("list")
  .description("show the children in this household")
  .action(() => {
    const h = household();
    if (!h.children.size) return console.log("No children yet. Add one with: openbuddies children add");
    for (const c of h.children.values()) {
      const subjects = listSubjects(c.dir, c.profile.id).map((s) => `${s.label} (${s.mode})`);
      const about = `${c.profile.name}, ${c.profile.age}${c.profile.year ? `, ${c.profile.year}` : ""}`;
      const allowance = `${allowanceFor(h, c).toLocaleString("en")} tokens a day${c.rules.daily_tokens ? "" : " (household default)"}`;
      console.log(`${c.profile.id.padEnd(12)} ${about}. Help level: ${c.rules.default_mode}. Allowance: ${allowance}${subjects.length ? `. Subjects: ${subjects.join(", ")}` : ""}`);
    }
  });

children
  .command("add")
  .description("add a child; asks questions, or pass everything as options")
  .option("--name <name>")
  .option("--age <age>")
  .option("--year <year>", "school year, e.g. \"Year 7\"", "")
  .option("-m, --mode <mode>", "how much help to give: strict, balanced or relaxed", "strict")
  .action(async (opts) => {
    const h = household();
    let spec: ChildSpec;
    if (opts.name) {
      spec = { name: opts.name, age: Number(opts.age), year: opts.year, mode: opts.mode };
    } else {
      if (!process.stdin.isTTY) {
        console.error("Pass --name and --age (and optionally --year and --mode), or run this in a terminal.");
        process.exit(1);
      }
      const { askChild } = await import("./init.js");
      spec = await askChild(h.children.size + 1);
    }
    try {
      const id = writeChild(h.dir, spec);
      // A running server picks the new folder up by itself; this keeps `pair` working straight away even if it isn't running.
      const db = new Db(join(h.dir, "data", "openbuddies.db"));
      db.syncChildren([{ id, name: spec.name }]);
      db.close();
      console.log(`Added ${spec.name} (${id}). Pair their phone with: openbuddies pair ${id}`);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

children
  .command("mode <child> <mode>")
  .description("change how much help a child gets in every subject without its own: strict, balanced or relaxed")
  .action((childId: string, mode: string) => {
    const h = household();
    try {
      setDefaultMode(childDirOrExit(h, childId), mode as Mode);
      console.log(`${h.children.get(childId)!.profile.name}'s help level is now ${mode}.`);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

children
  .command("allowance <child> <tokens>")
  .description('set how many AI tokens a child can use a day, e.g. 300000, or "default" for the household\'s budget.daily_tokens_per_child')
  .action((childId: string, tokens: string) => {
    const h = household();
    const dir = childDirOrExit(h, childId);
    const value = tokens === "default" ? null : Number(tokens.replace(/[,_\s]/g, ""));
    try {
      setAllowance(dir, value);
      const name = h.children.get(childId)!.profile.name;
      console.log(value === null ? `${name} now uses the household allowance (${h.config.budget.daily_tokens_per_child.toLocaleString("en")} tokens a day).` : `${name} can now use ${value.toLocaleString("en")} tokens a day.`);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

children
  .command("web <child> <mode>")
  .description("whether buddies can look things up on the internet for a child: off, trusted (trusted sites only) or open")
  .action((childId: string, mode: string) => {
    const h = household();
    try {
      setWeb(childDirOrExit(h, childId), { mode });
      console.log(`${h.children.get(childId)!.profile.name}'s internet is now ${mode}.`);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

const apps = program.command("apps").description("see, add and remove apps, and turn them on or off for each child");
apps.action(() => appsList(household()));
apps.command("gallery").description("apps you can add: OpenBuddies' starter apps and any catalogues you've added").action(() => appsGallery(household()));
apps
  .command("add <source>")
  .description("add an app from the gallery (its id), an https link to an app bundle, or a folder; shows it in full first")
  .option("-y, --yes", "don't ask (you've read it)")
  .option("--children <ids>", "turn it on for these children, e.g. sam,mia")
  .action((source: string, opts) => appsAdd(household(), source, opts));
apps.command("remove <id>").description("remove an added app (built-in apps can only be turned off)").action((id: string) => appsRemove(household(), id));
apps.command("on <child> <app>").description("turn an app on for a child").action((c: string, a: string) => appsSwitch(household(), c, a, true));
apps.command("off <child> <app>").description("turn an app off for a child").action((c: string, a: string) => appsSwitch(household(), c, a, false));

const images = program.command("images").description("Picture Studio's image model: status and setup");
images.action(() => imagesStatus(household()));
images
  .command("setup")
  .description("choose OpenAI or Google to draw Picture Studio's pictures and save its key")
  .option("--provider <name>", "openai or google")
  .option("--key <key>", "the API key")
  .option("--test", "draw one test picture first (costs a few pence)")
  .action((opts) => imagesSetup(household(), opts));

const web = program.command("web").description("looking things up on the internet: status, setup and a test search");
web.action(() => webStatus(household()));
web
  .command("setup")
  .description("choose a search provider (Brave, Tavily or SearXNG) and save its key, after a test search")
  .option("--provider <name>", "brave, tavily or searxng")
  .option("--key <key>", "the API key, or SearXNG's address")
  .action((opts) => webSetup(household(), opts));
web
  .command("test <query...>")
  .description("run a search with the household's provider and show what a child could use")
  .action(async (words: string[]) => process.exit((await webTest(household().search, words.join(" "))) ? 0 : 1));

const subjects = program.command("subjects").description("list, add, change or remove a child's subjects");

function childDirOrExit(h: Household, childId: string): string {
  const child = h.children.get(childId);
  if (!child) {
    console.error(`No child "${childId}". Children: ${[...h.children.keys()].join(", ")}`);
    process.exit(1);
  }
  return child.dir;
}

function printSubjects(dir: string, childId: string) {
  const list = listSubjects(dir, childId);
  if (!list.length) return console.log("  (no subjects yet)");
  const width = Math.max(...list.map((s) => s.label.length));
  for (const s of list) console.log(`  ${s.label.padEnd(width)}  ${s.mode}`);
}

subjects
  .command("list <child>")
  .description("show a child's subjects and how strict each one is")
  .action((childId: string) => {
    const h = household();
    printSubjects(childDirOrExit(h, childId), childId);
  });

subjects
  .command("add <child> <subject...>")
  .description('add a subject (e.g. "design & technology"); asks for strictness unless --mode is given')
  .option("-m, --mode <mode>", "strict, balanced or relaxed")
  .action(async (childId: string, words: string[], opts) => {
    const h = household();
    const dir = childDirOrExit(h, childId);
    let mode = opts.mode as Mode | undefined;
    if (!mode) {
      if (!process.stdin.isTTY) mode = "strict";
      else {
        const p = await import("@clack/prompts");
        const picked = await p.select<Mode>({
          message: `How strict for ${words.join(" ")}?`,
          initialValue: "strict",
          options: [
            { value: "strict", label: "Strict", hint: "never give answers" },
            { value: "balanced", label: "Balanced", hint: "answer after real effort" },
            { value: "relaxed", label: "Relaxed", hint: "explain freely" },
          ],
        });
        if (p.isCancel(picked)) process.exit(1);
        mode = picked;
      }
    }
    try {
      const name = setSubject(dir, words.join(" "), mode);
      console.log(`Added ${name} (${mode}).`);
      printSubjects(dir, childId);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

subjects
  .command("mode <child> <subject> <mode>")
  .description("change how strict a subject is: strict, balanced or relaxed")
  .action((childId: string, subject: string, mode: string) => {
    const h = household();
    const dir = childDirOrExit(h, childId);
    if (!listSubjects(dir, childId).some((s) => s.name === normaliseSubject(subject))) {
      console.error(`${childId} doesn't have "${subject}". Add it with: openbuddies subjects add ${childId} ${subject}`);
      process.exit(1);
    }
    try {
      setSubject(dir, subject, mode as Mode);
      printSubjects(dir, childId);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

subjects
  .command("remove <child> <subject...>")
  .description("remove a subject (questions about it are then treated as Strict)")
  .action((childId: string, words: string[]) => {
    const h = household();
    const dir = childDirOrExit(h, childId);
    try {
      console.log(`Removed ${removeSubject(dir, words.join(" "))}.`);
      printSubjects(dir, childId);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

program.parseAsync().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
