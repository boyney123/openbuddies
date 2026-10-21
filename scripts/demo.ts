// `pnpm demo`: run the whole app (kid + parent UI) without a household, an API key or the openbuddies CLI.
// A demo household lives in a temp folder, the tutor is scripted (no AI calls) and the UI is served by Vite with hot
// reload. It runs under `tsx watch`, so the server restarts when its code changes; the household (and so pairing) is
// kept across restarts, and made fresh when the database schema changes or with --fresh. Sam's kid app opens in the
// browser the first time (skip with --no-open).

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import open from "open";
import { createLogger, createServer as createVite } from "vite";
import { writeHousehold } from "../src/cli/scaffold.js";
import { createFauxBackend, fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from "../src/server/agent.js";
import { hashPin } from "../src/server/auth.js";
import type { Classifier } from "../src/server/classifier.js";
import { startServer } from "../src/server/index.js";

const API_PORT = Number(process.env.DEMO_API_PORT ?? 4848);
const WEB_PORT = Number(process.env.DEMO_WEB_PORT ?? 5173);
const PIN = "1234";

// Fingerprint of the migrations: a demo database made by an older schema is thrown away rather than migrated.
const migrations = join(import.meta.dirname, "..", "migrations");
const schema = createHash("sha256")
  .update(readdirSync(migrations).sort().map((f) => readFileSync(join(migrations, f), "utf8")).join("\n"))
  .digest("hex");
const home = join(tmpdir(), `openbuddies-demo-${API_PORT}`);
const schemaFile = join(home, "data", "demo-schema");
const fresh = process.argv.includes("--fresh") || !existsSync(join(home, "openbuddies.yaml")) || !existsSync(schemaFile) || readFileSync(schemaFile, "utf8") !== schema;
if (fresh) {
  rmSync(home, { recursive: true, force: true });
  writeHousehold({
    dir: home,
    parent: { name: "Alex", title: "Mum", pinHash: await hashPin(PIN) },
    models: { tutor: "anthropic/claude-sonnet-5-5", check: "anthropic/claude-haiku-5-5" },
    keys: { anthropic: "sk-ant-demo-not-a-real-key-0000000000" },
    port: API_PORT,
    children: [
      { name: "Sam", age: 12, year: "Year 7", mode: "strict", subjects: ["maths", "english"], modes: { english: "balanced" } },
      { name: "Mia", age: 9, year: "Year 4", mode: "balanced", subjects: ["maths", "science"], modes: { science: "relaxed" } },
    ],
  });
  writeFileSync(schemaFile, schema);
}

// A scripted tutor. Try: "I'm stuck on 2/3 + 1/4", "I don't know", "show me an example", "is it 3/7?", "I got 11/12",
// "remind me in a minute to drink water", "every weekday at 4 quiz me on times tables"; in Picture Studio, "a picture of a
// dragon", then "add a hat to it"; "make me a quiz about fractions".
const text = (m: unknown) => JSON.stringify(m ?? "");
const tutor: FauxResponseStep = (ctx: any) => {
  const last = ctx.messages.at(-1);
  // Requests from the check model: reading a photo (src/server/files.ts) and updating a buddy's memory (memory.ts).
  const request = text(last?.content);
  if (request.includes("Transcribe this photo.")) {
    return fauxAssistantMessage([fauxToolCall("photo_transcript", { text: "Q3. Work out 2/3 + 1/4\nQ4. Work out 3/5 - 1/10", summary: "Maths worksheet: adding fractions" })], { stopReason: "toolUse" });
  }
  // Setting up a reminder (src/server/schedules.ts). "in a minute" goes off a minute from now, so you can watch it.
  if (request.includes("The child's request:")) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const soon = new Date(Date.now() + 60_000);
    const tomorrow = new Date(Date.now() + 86_400_000);
    const draft = /every/i.test(request)
      ? { kind: "task", label: "Times tables quiz", text: "Quiz me on my times tables", repeat: "weekly", date: null, days: ["mon", "tue", "wed", "thu", "fri"], time: "16:00" }
      : /minute/i.test(request)
        ? { kind: "reminder", label: "Drink some water", text: "Time for a drink of water!", repeat: "once", date: day(soon), days: [], time: `${pad(soon.getHours())}:${pad(soon.getMinutes())}` }
        : { kind: "reminder", label: "Pack PE kit", text: "Time to pack your PE kit!", repeat: "once", date: day(tomorrow), days: [], time: "08:00" };
    return fauxAssistantMessage([fauxToolCall("schedule_request", { understood: true, question: null, ...draft })], { stopReason: "toolUse" });
  }
  // Planning a picture in Picture Studio (src/server/pictures.ts).
  if (request.includes("the last message is the child's newest")) {
    const newest = request.split("Child: ").at(-1) ?? "";
    const change = /\b(add|make it|change|now)\b/i.test(newest) && request.includes("The last picture made");
    const draw = change || /\b(picture|image|draw|surprise)\b/i.test(newest);
    return fauxAssistantMessage(
      [
        fauxToolCall("picture_request", {
          action: draw ? "draw" : "chat",
          edit: change,
          title: "Dragon at the seaside",
          prompt: "A friendly green dragon building a sandcastle on a sunny beach, cartoon style",
          say: change ? "Ooh, good idea! Changing it now…" : "Ooh, here it comes!",
        }),
      ],
      { stopReason: "toolUse" },
    );
  }
  if (request.includes("Update your notes.")) {
    const notes = "## Working on\n- Adding fractions with different denominators\n## Finds tricky\n- Finding a common denominator\n## What helps\n- Worked examples with different numbers";
    return fauxAssistantMessage([fauxToolCall("buddy_memory", { changed: true, notes })], { stopReason: "toolUse" });
  }
  // Only what the child typed, not the server instruction block appended to it.
  const said = text([...ctx.messages].reverse().find((m: any) => m.role === "user")?.content).split("<openbuddies-action")[0];
  const afterTool = last?.role === "toolResult";
  const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
  // Quizzes (src/server/quizzes.ts): what the child asked for, then the quiz itself.
  if (request.includes("The chat:")) {
    const style = /multiple choice/i.test(request) ? "multiple_choice" : /type/i.test(request) ? "single_answer" : null;
    return fauxAssistantMessage([fauxToolCall("quiz_request", { topic: "adding fractions", style, count: 4 })], { stopReason: "toolUse" });
  }
  if (request.includes("Topic: ")) {
    const mc = request.includes("multiple choice");
    const q = (question: string, answer: string, wrong: string[], explanation: string) => ({
      question,
      choices: mc ? [answer, ...wrong] : [],
      answer,
      accept: [],
      hint: "Make the bottom numbers match first.",
      explanation,
    });
    return fauxAssistantMessage(
      [
        fauxToolCall("quiz", {
          title: "Fraction Frenzy",
          questions: [
            q("What is 1/2 + 1/4?", "3/4", ["2/6", "1/6", "2/4"], "1/2 is the same as 2/4, and 2/4 + 1/4 = 3/4."),
            q("What is 1/3 + 1/3?", "2/3", ["2/6", "1/9", "1/3"], "The bottoms already match, so add the tops: 1 + 1 = 2."),
            q("What is 2/5 + 1/5?", "3/5", ["3/10", "2/25", "1/5"], "Same bottoms, so 2 + 1 = 3 fifths."),
            q("What is 1/2 + 1/3?", "5/6", ["2/5", "2/6", "1/6"], "Use sixths: 3/6 + 2/6 = 5/6."),
          ],
        }),
      ],
      { stopReason: "toolUse" },
    );
  }
  // A reminder going off: the buddy says it in its own words.
  if (said.includes("Remind them in your own words")) return fauxAssistantMessage("Psst! It's time for that reminder you asked me for. I'm here if you need a hand!");
  if (said.includes("11/12")) {
    if (!afterTool) return call("check_answer", { answer: "11/12", correct: true, feedback: "Spot on: 8/12 + 3/12 = 11/12." });
    return text(ctx.messages.at(-2)?.content).includes("mark_solved")
      ? fauxAssistantMessage("Brilliant work, you found the common denominator yourself!")
      : call("mark_solved", { label: "2/3 + 1/4" });
  }
  if (said.includes("3/7")) {
    return afterTool
      ? fauxAssistantMessage("Can you tell me why we can't just add the bottoms?")
      : call("check_answer", { answer: "3/7", correct: false, feedback: "Close! Look again at how you added the denominators." });
  }
  if (said.includes("example")) {
    return afterTool
      ? fauxAssistantMessage("Now try the same steps with 2/3 + 1/4. What's your common denominator?")
      : call("show_worked_example", { problem: "1/3 + 1/5", steps: ["Find a number both 3 and 5 go into: 15", "1/3 = 5/15 and 1/5 = 3/15", "5/15 + 3/15 = 8/15"] });
  }
  if (/don.t know|no idea|hint/i.test(said)) {
    return afterTool
      ? fauxAssistantMessage("Have a think and tell me what you get!")
      : call("give_hint", { rung: "nudge", text: "To add fractions the bottoms need to match. What number do both 3 and 4 go into?" });
  }
  if (said.includes("2/3")) {
    return afterTool
      ? fauxAssistantMessage("Nice, let's do this together. What have you tried so far?")
      : call("set_active_problem", { label: "2/3 + 1/4", text: "Work out 2/3 + 1/4. Give your answer as a fraction." });
  }
  return fauxAssistantMessage("Hi! I'm a demo tutor. Try telling me you're stuck on 2/3 + 1/4.");
};
const faux = createFauxBackend();
faux.setResponses(Array.from({ length: 10000 }, () => tutor));

// Keyword rules in place of the AI classifier and answer-leak check.
const classifier: Classifier = {
  classify: async (t: string) => ({
    intent: {
      intent: /remind|every weekday|every day/i.test(t) ? "schedule" : /quiz/i.test(t) ? "quiz" : /got|is it/i.test(t) ? "check_my_work" : /know|idea|hint|example|stuck|2\/3/i.test(t) ? "stuck" : "chat",
      pressure: "none",
      subject: "maths",
      welfare: /stupid|hate myself/i.test(t) ? "upset" : "fine",
      problem: "Work out 2/3 + 1/4. Give your answer as a fraction.",
    } as any,
    tokens: 1,
  }),
  leakCheck: async () => ({ gives_answer: false, reason: "demo", tokens: 1 }),
};

const server = await startServer({
  home,
  port: API_PORT,
  loopbackOnly: true,
  detectTailscale: false,
  faux,
  classifier,
  // Picture Studio without an image model: the OpenBuddies icon stands in for the picture, after a few seconds of painting.
  pictures: {
    available: () => true,
    draw: async () => {
      await new Promise((r) => setTimeout(r, 6000));
      return { data: readFileSync(join(import.meta.dirname, "..", "web", "public", "icon-512.png")), mime: "image/png" };
    },
  },
  log: () => {},
});

process.env.OPENBUDDIES_API_PORT = String(API_PORT);
// Requests caught mid-restart are expected; don't print them as errors.
const logger = createLogger();
const logError = logger.error;
logger.error = (msg, opts) => void (!msg.includes("Request is outdated") && logError(msg, opts));
const vite = await createVite({ configFile: join(import.meta.dirname, "..", "vite.config.ts"), customLogger: logger, server: { port: WEB_PORT, strictPort: true } });
await vite.listen();
const web = `http://localhost:${WEB_PORT}`;

/** Prints a fresh pairing link per child and returns them. */
const links = (opened?: string) => {
  const urls = Object.fromEntries(["sam", "mia"].map((c) => [c, `${web}/pair?token=${server.db.createPairingToken(c, 60)}`]));
  console.log("\n  Kid app (open in a new private window per child, or use phone emulation in DevTools):");
  for (const [child, url] of Object.entries(urls)) console.log(`    ${child.padEnd(4)} ${url}${child === opened ? "  (opened in your browser)" : ""}`);
  console.log(`\n  Parent view: ${web}/parent  (PIN ${PIN})`);
  console.log("\n  Press Enter to restart with new pairing links (each one works once). Ctrl+C to stop.\n");
  return urls;
};
console.log(`\n  OpenBuddies demo running. Scripted tutor, no AI calls. Household: ${home}${fresh ? " (new)" : ""}`);
// Open the browser only for a new household; a restart keeps the paired tabs you already have.
const autoOpen = fresh && !process.argv.includes("--no-open");
const first = links(autoOpen ? "sam" : undefined);
if (autoOpen) open(first.sam).catch(() => console.log("  Couldn't open a browser; use the link above."));

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  // Open browser tabs keep sockets alive, so don't wait on them for long.
  const settle = (p: Promise<unknown>) => Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
  await Promise.all([settle(vite.close()), settle(server.close())]);
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
