import { describe, expect, it } from "vitest";
import type { Rung } from "../src/shared/protocol.js";
import type { Mode } from "../src/server/config.js";
import { advance, decide, INTENTS, PRESSURES, WELFARES, type Action, type IntentLabel, type LadderState, type Pressure } from "../src/server/decide.js";
import { intent, rules } from "./helpers.js";

const app = { hint_ladder: true };
const onRung = (rung: Rung, attempts = 0): LadderState => ({ problem: { rung, attempts, correct: false, subject: "maths" }, isNewProblem: false });
const MODES: Mode[] = ["strict", "balanced", "relaxed"];

/** The spec's rules, written out independently of decide() for a problem sitting on "nudge" with no attempts. */
function expected(mode: Mode, i: IntentLabel, p: Pressure): Pick<Action, "kind" | "rung" | "enforce" | "mayRevealAnswer" | "firm"> {
  const enforce = mode !== "relaxed";
  const mayRevealAnswer = mode === "relaxed";
  const firm = p !== "none";
  switch (i) {
    case "check_my_work":
      return { kind: "check_answer", rung: "check", enforce, mayRevealAnswer, firm };
    case "off_topic":
    case "chat":
      return { kind: "redirect", rung: "nudge", enforce, mayRevealAnswer, firm };
    case "learn_concept":
      return { kind: "explain", rung: "nudge", enforce, mayRevealAnswer, firm };
    case "general":
      return { kind: "help", rung: "nudge", enforce, mayRevealAnswer, firm };
    case "schedule":
      return { kind: "schedule", rung: "nudge", enforce, mayRevealAnswer, firm };
    case "quiz":
      return { kind: "quiz", rung: "nudge", enforce, mayRevealAnswer, firm };
    case "wants_answer":
    case "stuck":
      if (mode === "relaxed") return { kind: "explain", rung: "nudge", enforce, mayRevealAnswer, firm };
      return p === "jailbreak"
        ? { kind: "nudge", rung: "nudge", enforce, mayRevealAnswer, firm }
        : { kind: "worked_example", rung: "worked_example", enforce, mayRevealAnswer, firm };
  }
}

describe("decide(): every intent × pressure × mode", () => {
  for (const mode of MODES) {
    for (const i of INTENTS) {
      for (const p of PRESSURES) {
        it(`${mode} / ${i} / ${p}`, () => {
          const a = decide(intent({ intent: i, pressure: p }), onRung("nudge"), rules({ maths: mode }), app);
          expect({ kind: a.kind, rung: a.rung, enforce: a.enforce, mayRevealAnswer: a.mayRevealAnswer, firm: a.firm }).toEqual(expected(mode, i, p));
          expect(a.mode).toBe(mode);
          expect(a.gentle).toBe(false);
        });
      }
    }
  }
});

describe("decide(): welfare", () => {
  for (const mode of MODES) {
    for (const i of INTENTS) {
      it(`concerning pauses tutoring (${mode} / ${i})`, () => {
        const a = decide(intent({ intent: i, welfare: "concerning", pressure: "jailbreak" }), onRung("nudge"), rules({ maths: mode }), app);
        expect(a.kind).toBe("welfare_response");
        expect(a.rung).toBe("nudge");
      });
    }
  }
  it("upset keeps tutoring, gently", () => {
    const a = decide(intent({ welfare: "upset" }), onRung("ask"), rules(), app);
    expect(a.kind).toBe("nudge");
    expect(a.gentle).toBe(true);
  });
  it("covers all welfare labels", () => expect(WELFARES).toEqual(["fine", "upset", "concerning"]));
});

describe("decide(): ladder transitions", () => {
  const stuck = intent({ intent: "stuck" });
  const demand = intent({ intent: "wants_answer", pressure: "mild" });
  const jailbreak = intent({ intent: "wants_answer", pressure: "jailbreak" });

  it("a new problem starts at ask, whatever the pressure", () => {
    for (const i of [stuck, demand, jailbreak]) {
      expect(decide(i, { problem: { rung: "ask", attempts: 0, correct: false, subject: "maths" }, isNewProblem: true }, rules(), app).kind).toBe("ask");
    }
  });
  it("no problem yet starts at ask", () => {
    const a = decide(demand, { problem: null, isNewProblem: false }, rules(), app);
    expect(a).toMatchObject({ kind: "ask", rung: "ask" });
  });
  it("ask → nudge → worked_example, and never past worked_example", () => {
    expect(decide(demand, onRung("ask"), rules(), app).rung).toBe("nudge");
    expect(decide(demand, onRung("nudge"), rules(), app).rung).toBe("worked_example");
    expect(decide(demand, onRung("worked_example"), rules(), app).rung).toBe("worked_example");
  });
  it("jailbreak holds the current rung", () => {
    for (const r of ["ask", "nudge", "worked_example"] as Rung[]) expect(decide(jailbreak, onRung(r), rules(), app).rung).toBe(r);
  });
  it("after a wrong check, stuck goes to a nudge on the wrong step", () => {
    expect(decide(stuck, onRung("check", 1), rules(), app).rung).toBe("nudge");
    expect(decide(jailbreak, onRung("check", 1), rules(), app).rung).toBe("nudge");
  });
  it("a shorter configured ladder caps lower", () => {
    const short = rules({ maths: "strict" }, { hint_ladder: ["ask", "nudge", "check"] });
    expect(decide(demand, onRung("nudge"), short, app).rung).toBe("nudge");
  });
  it("balanced reveals only after two genuine attempts", () => {
    const b = rules({ maths: "balanced" });
    expect(decide(demand, onRung("worked_example", 1), b, app).kind).toBe("worked_example");
    const a = decide(demand, onRung("worked_example", 2), b, app);
    expect(a).toMatchObject({ kind: "reveal", enforce: false, mayRevealAnswer: true });
  });
  it("strict never reveals, however many attempts", () => {
    expect(decide(demand, onRung("worked_example", 10), rules(), app)).toMatchObject({ kind: "worked_example", enforce: true, mayRevealAnswer: false });
  });
  it("an unlisted subject is strict", () => {
    const a = decide(intent({ subject: "history", intent: "wants_answer" }), onRung("nudge"), rules({ maths: "relaxed" }), app);
    expect(a).toMatchObject({ mode: "strict", enforce: true });
  });
  it("'other' subject falls back to the active problem's subject", () => {
    const a = decide(intent({ subject: "other" }), onRung("nudge"), rules({ maths: "relaxed" }), app);
    expect(a.mode).toBe("relaxed");
  });
});

describe("advance()", () => {
  const base = decide(intent(), onRung("ask"), rules(), app);
  it("moves to the action's rung for ladder actions", () => {
    expect(advance("ask", { ...base, kind: "nudge", rung: "nudge" })).toBe("nudge");
    expect(advance("nudge", { ...base, kind: "check_answer", rung: "check" })).toBe("check");
  });
  it("leaves the rung alone for redirect, explain, reveal and welfare", () => {
    for (const kind of ["redirect", "explain", "reveal", "welfare_response"] as const) expect(advance("nudge", { ...base, kind, rung: "nudge" })).toBe("nudge");
  });
});

describe("decide() in a studio app", () => {
  it("goes along with describing a picture instead of steering back to homework", () => {
    const studio = { hint_ladder: false, kind: "studio" as const };
    for (const i of ["off_topic", "chat", "general", "wants_answer"] as const) expect(decide(intent({ intent: i }), { problem: null, isNewProblem: false }, rules(), studio).kind).toBe("help");
    expect(decide(intent({ intent: "chat", welfare: "concerning" }), { problem: null, isNewProblem: false }, rules(), studio).kind).toBe("welfare_response");
  });
});
