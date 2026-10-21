import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Draft, RespondInput } from "../src/server/agent.js";
import type { Classifier, LeakVerdict } from "../src/server/classifier.js";
import { loadHousehold, type Household } from "../src/server/config.js";
import { Db } from "../src/server/db.js";
import type { Intent } from "../src/server/decide.js";
import { ASKS_TO_REMEMBER, Pipeline, type PipelineDeps } from "../src/server/pipeline.js";
import { SAFE_FALLBACK } from "../src/server/prompts.js";
import { effectVisibleText, type ToolEffect } from "../src/server/tools.js";
import type { ServerEvent } from "../src/shared/protocol.js";
import { intent, makeHousehold } from "./helpers.js";

type Script = { text: string; effects?: ToolEffect[] };

class FakeTutor {
  inputs: RespondInput[] = [];
  rollbacks = 0;
  constructor(public script: Script[]) {}
  async respond(input: RespondInput): Promise<Draft> {
    this.inputs.push(input);
    const s = this.script.shift() ?? { text: "What's your next step?" };
    const effects = s.effects ?? [];
    return {
      text: s.text,
      effects,
      calls: effects.map((e) => ({ tool: e.type, args: e, accepted: true, error: null })),
      visibleText: [...effects.map(effectVisibleText), s.text].filter(Boolean).join("\n\n"),
      tokens: 100,
      piSessionId: "pi-1",
      rollback: async () => {
        this.rollbacks++;
      },
    };
  }
}

class FakeClassifier implements Classifier {
  leakChecks: string[] = [];
  /** The problem each leak check guarded. */
  guarded: string[] = [];
  constructor(public intents: Partial<Intent>[], public leaks: (draft: string) => boolean = (d) => /11\/12/.test(d)) {}
  async classify() {
    return { intent: intent(this.intents.shift() ?? {}), tokens: 10 };
  }
  async leakCheck(problem: string, draft: string): Promise<LeakVerdict & { tokens: number }> {
    this.leakChecks.push(draft);
    this.guarded.push(problem);
    const leak = this.leaks(draft);
    return { gives_answer: leak, reason: leak ? "states the answer" : "ok", tokens: 10 };
  }
}

let household: Household;
let db: Db;
let events: ServerEvent[];
/** How many alerts were already raised each time the tutor was asked for a reply. */
let alertsAtReply: number[];

function pipeline(tutor: FakeTutor, classifier: Classifier, extra: Partial<PipelineDeps> = {}) {
  return new Pipeline({
    ...extra,
    db,
    tutor: {
      respond: async (i) => {
        alertsAtReply.push(db.listAlerts().length);
        return tutor.respond(i);
      },
    },
    classifier,
    household: () => household,
    emit: (_c, e) => events.push(e),
  });
}

const childVisible = () =>
  JSON.stringify(events.filter((e) => e.type === "items" || e.type === "reply_delta" || e.type === "problem"));

beforeEach(async () => {
  const dir = await makeHousehold();
  household = loadHousehold(dir);
  db = new Db(join(dir, "data", "openbuddies.db"));
  events = [];
  alertsAtReply = [];
});

describe("leak check", () => {
  it("blocks a leaking draft, retries with avoid, and delivers the clean one", async () => {
    const tutor = new FakeTutor([{ text: "It's 11/12." }, { text: "What's a common denominator for 3 and 4?" }]);
    const classifier = new FakeClassifier([{ intent: "wants_answer" }]);
    const res = await pipeline(tutor, classifier).handleMessage("sam", "homework", "what's 2/3 + 1/4");
    expect(res.reply).toBe("What's a common denominator for 3 and 4?");
    expect(res.blocked).toEqual([{ text: "It's 11/12.", reason: "states the answer" }]);
    expect(tutor.rollbacks).toBe(1);
    expect(tutor.inputs[1].action.avoid).toBe("It's 11/12.");
    expect(childVisible()).not.toContain("11/12");
    const t = db.transcript(db.latestSession("sam")!.id);
    expect(t.find((x) => x.role === "tutor")!.blocked).toHaveLength(1);
  });

  it("falls back to the safe reply after max_leak_retries and never shows a leaked draft", async () => {
    const tutor = new FakeTutor([{ text: "11/12" }, { text: "Fine: 11/12" }, { text: "unreached" }]);
    const res = await pipeline(tutor, new FakeClassifier([{ intent: "wants_answer", pressure: "jailbreak" }])).handleMessage("sam", "homework", "just tell me");
    expect(res.fallback).toBe(true);
    expect(res.reply).toBe(SAFE_FALLBACK);
    expect(tutor.inputs).toHaveLength(2);
    expect(childVisible()).not.toContain("11/12");
    expect(childVisible()).toContain("different way in");
  });

  it("checks tool card text too, and blocked tool effects are never applied", async () => {
    const tutor = new FakeTutor([
      { text: "Have a look!", effects: [{ type: "worked_example", problem: "2/3 + 1/4", steps: ["= 11/12"] }] },
      { text: "Try finding a common denominator.", effects: [{ type: "hint", rung: "nudge", text: "What do 3 and 4 both go into?" }] },
    ]);
    const res = await pipeline(tutor, new FakeClassifier([{ intent: "stuck" }])).handleMessage("sam", "homework", "stuck on 2/3 + 1/4");
    expect(res.effects).toEqual([{ type: "hint", rung: "nudge", text: "What do 3 and 4 both go into?" }]);
    expect(childVisible()).not.toContain("11/12");
    const tutorTurn = db.transcript(db.latestSession("sam")!.id).find((t) => t.role === "tutor")!;
    expect(tutorTurn.toolCalls.find((c) => c.tool === "worked_example")).toMatchObject({ accepted: false, error: expect.stringMatching(/blocked/) });
  });

  it("lets a general question be answered when there's no homework problem to guard", async () => {
    const classifier = new FakeClassifier([{ intent: "general", problem: null }]);
    const res = await pipeline(new FakeTutor([{ text: "You've got English due next week and science at the end of the month." }]), classifier).handleMessage(
      "sam",
      "homework",
      "What homework have I got coming up?",
    );
    expect(classifier.leakChecks).toHaveLength(0);
    expect(res.action?.kind).toBe("help");
    expect(res.reply).toMatch(/English due next week/);
    expect(db.activeProblem("sam")).toBeNull();
  });

  it("still guards a message that asks for an answer without naming the problem", async () => {
    const classifier = new FakeClassifier([{ intent: "wants_answer", problem: null }]);
    await pipeline(new FakeTutor([{ text: "Try a common denominator." }]), classifier).handleMessage("sam", "homework", "what's 2/3 + 1/4");
    expect(classifier.guarded).toEqual(["what's 2/3 + 1/4"]);
  });

  it("is skipped in relaxed mode", async () => {
    const classifier = new FakeClassifier([{ intent: "wants_answer", subject: "science" }]);
    const res = await pipeline(new FakeTutor([{ text: "Plants make glucose from 11/12 sunlight." }]), classifier).handleMessage("sam", "homework", "explain photosynthesis");
    expect(classifier.leakChecks).toHaveLength(0);
    expect(res.action?.enforce).toBe(false);
  });
});

describe("welfare", () => {
  it("raises an alert for the parent before the reply is generated, with a summary not the message", async () => {
    const pl = pipeline(new FakeTutor([{ text: "I'm really glad you told me. Can you talk to Dad?" }]), new FakeClassifier([{ welfare: "concerning", intent: "chat" }]));
    const res = await pl.handleMessage("sam", "homework", "I want to disappear and nobody would care");
    expect(alertsAtReply).toEqual([1]);
    expect(res.action?.kind).toBe("welfare_response");
    expect(db.listAlerts()).toHaveLength(1);
    expect(db.listAlerts()[0].severity).toBe("high");
    expect(db.listAlerts()[0].summary).not.toContain("disappear");
  });

  it("alerts on upset when sensitivity is high", async () => {
    await pipeline(new FakeTutor([{ text: "That sounds frustrating. What part is tricky?" }]), new FakeClassifier([{ welfare: "upset" }])).handleMessage("sam", "homework", "I'm so stupid");
    expect(db.listAlerts()[0].severity).toBe("medium");
  });

  it("raises flag_for_parent alerts even from a blocked draft", async () => {
    const tutor = new FakeTutor([
      { text: "It's 11/12", effects: [{ type: "flag", severity: "high", summary: "Sam mentioned being hurt." }] },
      { text: "What's the first step?" },
    ]);
    // flags arrive through onFlag in the real adapter; simulate that.
    const wrapped = new FakeTutor([]);
    wrapped.respond = async (i) => {
      const d = await tutor.respond(i);
      for (const e of d.effects) if (e.type === "flag") i.onFlag?.(e.severity, e.summary);
      return d;
    };
    await pipeline(wrapped, new FakeClassifier([{}])).handleMessage("sam", "homework", "...");
    expect(db.listAlerts().map((a) => a.summary)).toEqual(["Sam mentioned being hurt."]);
  });
});

describe("hint ladder state", () => {
  it("climbs one rung per stuck message, holds under jailbreak, and never passes worked_example", async () => {
    const tutor = new FakeTutor([]);
    const classifier = new FakeClassifier([
      { intent: "stuck" },
      { intent: "wants_answer" },
      { intent: "wants_answer", pressure: "jailbreak" },
      { intent: "wants_answer" },
      { intent: "wants_answer" },
    ]);
    const pl = pipeline(tutor, classifier);
    const rungs: (string | null | undefined)[] = [];
    for (let i = 0; i < 5; i++) rungs.push((await pl.handleMessage("sam", "homework", `msg ${i}`)).action?.rung);
    expect(rungs).toEqual(["ask", "nudge", "nudge", "worked_example", "worked_example"]);
    expect(db.activeProblem("sam")!.rung).toBe("worked_example");
  });

  it("a different problem starts a new ladder", async () => {
    const classifier = new FakeClassifier([{ intent: "stuck" }, { intent: "stuck" }, { intent: "stuck", problem: "3/5 - 1/10" }]);
    const pl = pipeline(new FakeTutor([]), classifier);
    await pl.handleMessage("sam", "homework", "a");
    await pl.handleMessage("sam", "homework", "b");
    const res = await pl.handleMessage("sam", "homework", "c");
    expect(res.action).toMatchObject({ kind: "ask", newProblem: true });
    expect(db.activeProblem("sam")!.text).toBe("3/5 - 1/10");
  });

  it("records attempts, and solving resets for the next problem", async () => {
    const tutor = new FakeTutor([
      { text: "Not quite, check your denominator.", effects: [{ type: "check", answer: "3/7", correct: false, feedback: "Look at step 1" }] },
      { text: "Yes!", effects: [{ type: "check", answer: "11/12", correct: true, feedback: "Spot on" }, { type: "solved", label: "Q3" }] },
    ]);
    const pl = pipeline(tutor, new FakeClassifier([{ intent: "check_my_work" }, { intent: "check_my_work" }]));
    await pl.handleMessage("sam", "homework", "is it 3/7");
    expect(db.activeProblem("sam")).toMatchObject({ attempts: 1, rung: "check" });
    await pl.handleMessage("sam", "homework", "is it 11/12 because 8/12 + 3/12");
    expect(db.activeProblem("sam")).toBeNull();
    expect(events.filter((e) => e.type === "problem").at(-1)).toMatchObject({ type: "problem", problem: null });
  });

  it("keeps the rung across devices because state is server-side", async () => {
    const pl = pipeline(new FakeTutor([]), new FakeClassifier([{ intent: "stuck" }, { intent: "stuck" }]));
    await pl.handleMessage("sam", "homework", "phone");
    await pl.handleMessage("sam", "homework", "phone again");
    const sync = db.uiSync("sam", 0);
    expect(sync.items.filter((i) => i.item.kind === "child").map((i) => (i.item as any).text)).toEqual(["phone", "phone again"]);
    expect(db.activeProblem("sam")!.rung).toBe("nudge");
  });

  it("keeps each buddy's chat and problem separate, and a reply never lands in another buddy's chat", async () => {
    const zippy = db.createBuddy("sam", { name: "Zippy", color: "blue", description: "", subject: null });
    const bolt = db.createBuddy("sam", { name: "Bolt", color: "coral", description: "", subject: null });
    const pl = pipeline(new FakeTutor([]), new FakeClassifier([{ intent: "stuck" }, { intent: "stuck", problem: "3x = 12" }]));
    // The child sent this to Zippy, then switched to Bolt before the reply arrived.
    await pl.handleMessage("sam", "homework", "help with 2/3 + 1/4", zippy.id);
    expect(events.filter((e) => e.type === "items" || e.type === "reply_delta")).toEqual([]);
    expect(db.uiSync("sam", 0, zippy.id).items.map((i) => i.item.kind)).toEqual(["child", "tutor"]);
    expect(db.uiSync("sam", 0, bolt.id).items).toEqual([]);

    await pl.handleMessage("sam", "homework", "help with 3x = 12", bolt.id);
    expect(events.some((e) => e.type === "items")).toBe(true);
    expect(db.activeProblem("sam", zippy.id)!.text).toBe("2/3 + 1/4");
    expect(db.activeProblem("sam", bolt.id)!.text).toBe("3x = 12");
  });
});

describe("looking things up on the internet", () => {
  const found = { facts: [{ text: "Mars is about -60C on average.", source: 0 }], sources: [{ title: "Mars facts", site: "nasa.gov", url: "https://nasa.gov/mars" }], tokens: 30 };

  it("gives the buddy what was found, fenced, and shows the child where it's from", async () => {
    const asked: string[] = [];
    const web = { available: () => true, lookUp: async (_c: any, _q: string, query: string) => (asked.push(query), found) };
    const offered: boolean[] = [];
    const classifier = new FakeClassifier([{ intent: "general", problem: null, lookup: "temperature on mars" }]);
    const spy: Classifier = { classify: (_t, st) => (offered.push(!!st.web), classifier.classify()), leakCheck: (p, d) => classifier.leakCheck(p, d) };
    const tutor = new FakeTutor([{ text: "It's really cold on Mars!" }]);
    await pipeline(tutor, spy, { web }).handleMessage("sam", "homework", "how cold is it on mars?");
    expect(offered).toEqual([true]);
    expect(asked).toEqual(["temperature on mars"]);
    expect(tutor.inputs[0].material).toContain("Mars is about -60C on average. [nasa.gov]");
    expect(db.uiSync("sam", 0).items.map((i) => i.item)).toContainEqual({ kind: "looked_up", sources: found.sources });
    expect(db.lookupsToday("sam")).toBe(1);
  });

  it("stops at the child's daily limit, and never when it's off", async () => {
    const lookUp = vi.fn(async () => found);
    const sam = household.children.get("sam")!;
    sam.rules = { ...sam.rules, web: { ...sam.rules.web, daily_lookups: 0 } };
    const offered: boolean[] = [];
    const classifier = new FakeClassifier([{ intent: "general", lookup: "x" }]);
    const spy: Classifier = { classify: (_t, st) => (offered.push(!!st.web), classifier.classify()), leakCheck: (p, d) => classifier.leakCheck(p, d) };
    await pipeline(new FakeTutor([]), spy, { web: { available: () => true, lookUp } }).handleMessage("sam", "homework", "how cold is mars?");
    expect(offered).toEqual([false]);
    sam.rules = { ...sam.rules, web: { ...sam.rules.web, mode: "off", daily_lookups: 30 } };
    await pipeline(new FakeTutor([]), new FakeClassifier([{ intent: "general", lookup: "x" }]), { web: { available: () => true, lookUp } }).handleMessage("sam", "homework", "how cold is mars?");
    expect(lookUp).not.toHaveBeenCalled();
  });
});

describe("files the child mentions", () => {
  it("finds the one they mean, shows the buddy it, and guards what's in it", async () => {
    const zippy = db.createBuddy("sam", { name: "Zippy", color: "blue", description: "", subject: null });
    const add = (name: string, summary: string, text: string) => {
      const id = db.addFile({ buddyId: zippy.id, childId: "sam", name, kind: "image", mime: "image/jpeg", size: 1, path: "data/files/x.jpg", status: "ready", text, summary });
      return id;
    };
    add("IMG_0001.jpg", "Maths worksheet: fractions", "Q1 2/3 + 1/4");
    const history = add("IMG_0002.jpg", "History homework: the Tudors", "Why did Henry VIII break with Rome?");
    const tutor = new FakeTutor([{ text: "Let's look at it together. What do you already know about Henry VIII?" }]);
    const classifier = new FakeClassifier([{ intent: "learn_concept", problem: null, files: [history] }]);
    const offered: any[] = [];
    const spy: Classifier = { classify: (t, st) => (offered.push(st.files), classifier.classify()), leakCheck: (p, d, c) => classifier.leakCheck(p, d) };
    await pipeline(tutor, spy).handleMessage("sam", "homework", "check our history homework for this week and help me understand it", zippy.id);
    expect(offered[0].map((f: any) => f.name).sort()).toEqual(["IMG_0001.jpg", "IMG_0002.jpg"]);
    expect(tutor.inputs[0].files).toEqual([{ id: history, name: "IMG_0002.jpg" }]);
    expect(classifier.guarded).toEqual(["IMG_0002.jpg:\nWhy did Henry VIII break with Rome?"]);
    const items = db.uiSync("sam", 0, zippy.id).items.map((i) => i.item);
    expect(items).toContainEqual({ kind: "files_used", files: [{ id: history, name: "IMG_0002.jpg", kind: "image" }] });
  });

  it("never shows the buddy a file that isn't this buddy's", async () => {
    const zippy = db.createBuddy("sam", { name: "Zippy", color: "blue", description: "", subject: null });
    const bolt = db.createBuddy("sam", { name: "Bolt", color: "coral", description: "", subject: null });
    const boltsFile = db.addFile({ buddyId: bolt.id, childId: "sam", name: "secret.jpg", kind: "image", mime: "image/jpeg", size: 1, path: "x", status: "ready", text: "t", summary: "s" });
    const tutor = new FakeTutor([]);
    await pipeline(tutor, new FakeClassifier([{ intent: "stuck", files: [boltsFile] }])).handleMessage("sam", "homework", "look at secret.jpg", zippy.id);
    expect(tutor.inputs[0].files).toEqual([]);
  });
});

describe("guards around the pipeline", () => {
  it("stops when the daily token budget is used up", async () => {
    db.addUsage("sam", household.config.budget.daily_tokens_per_child);
    const tutor = new FakeTutor([]);
    const res = await pipeline(tutor, new FakeClassifier([])).handleMessage("sam", "homework", "help");
    expect(tutor.inputs).toHaveLength(0);
    expect(res.reply).toMatch(/resting until tomorrow/);
  });

  it("uses the child's own allowance when they have one", async () => {
    const sam = household.children.get("sam")!;
    sam.rules = { ...sam.rules, daily_tokens: 20_000 };
    db.addUsage("sam", 20_000);
    const tutor = new FakeTutor([]);
    const res = await pipeline(tutor, new FakeClassifier([])).handleMessage("sam", "homework", "help");
    expect(tutor.inputs).toHaveLength(0);
    expect(res.reply).toMatch(/resting until tomorrow/);
  });

  it("logs every turn with intent and action", async () => {
    await pipeline(new FakeTutor([]), new FakeClassifier([{ intent: "stuck" }])).handleMessage("sam", "homework", "help me");
    const [child, tutor] = db.transcript(db.latestSession("sam")!.id);
    expect(child).toMatchObject({ role: "child", text: "help me", intent: { intent: "stuck" }, action: { kind: "ask" } });
    expect(tutor.role).toBe("tutor");
  });

  it("answers messages sent while the buddy is busy together, in one turn", async () => {
    const tutor = new FakeTutor([]);
    const pl = pipeline(tutor, new FakeClassifier([{}, {}]));
    const first = pl.handleMessage("sam", "homework", "what's 2/3 + 1/4");
    await new Promise((r) => setTimeout(r, 0));
    const burst = ["wait", "no", "i meant 2/3 + 1/5"].map((t) => pl.handleMessage("sam", "homework", t));
    const results = await Promise.all([first, ...burst]);
    expect(tutor.inputs.map((i) => i.text)).toEqual(["what's 2/3 + 1/4", "wait\nno\ni meant 2/3 + 1/5"]);
    expect(new Set(results.slice(1)).size).toBe(1);
    // Each message is still its own message in the chat and the transcript.
    const children = db.transcript(db.latestSession("sam")!.id).filter((t) => t.role === "child");
    expect(children.map((t) => t.text)).toEqual(["what's 2/3 + 1/4", "wait", "no", "i meant 2/3 + 1/5"]);
  });
});

describe("parent transcript", () => {
  it("records exactly what the child saw against each turn", async () => {
    const tutor = new FakeTutor([
      { text: "It's 11/12" },
      { text: "Try this one first.", effects: [{ type: "hint", rung: "ask", text: "What have you tried?" }] },
    ]);
    await pipeline(tutor, new FakeClassifier([{ intent: "stuck" }])).handleMessage("sam", "homework", "help with 2/3 + 1/4");
    const [child, reply] = db.transcript(db.latestSession("sam")!.id);
    expect(child.items).toEqual([{ kind: "child", text: "help with 2/3 + 1/4" }]);
    expect(reply.items).toEqual([
      { kind: "hint", rung: "ask", text: "What have you tried?" },
      { kind: "tutor", text: "Try this one first." },
    ]);
    // The blocked draft is recorded for the parent but is not among what the child saw.
    expect(reply.blocked[0].text).toContain("11/12");
    expect(JSON.stringify(reply.items)).not.toContain("11/12");
  });
});

describe("asking the buddy to remember", () => {
  it.each(["remember my test is on Friday", "Can you remember that I find fractions hard", "don't forget I have a spelling test", "please write this down"])(
    "spots %s",
    (t) => expect(ASKS_TO_REMEMBER.test(t)).toBe(true),
  );
  it.each(["I can't remember how to do this", "i don't remember that", "I remember doing these last year", "what's 2/3 + 1/4"])("ignores %s", (t) =>
    expect(ASKS_TO_REMEMBER.test(t)).toBe(false),
  );
});
