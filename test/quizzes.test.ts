import { describe, expect, it } from "vitest";
import { answer, checkQuiz, isRight, questionViews, review, type QuizQuestion } from "../src/server/quizzes.js";

const mc = { question: "What is 1/2 + 1/4?", choices: ["3/4", "2/6", "1/6", "2/4"], answer: "3/4", accept: [], hint: "Make the bottoms match.", explanation: "1/2 is 2/4, and 2/4 + 1/4 = 3/4." };
const typed = { question: "What is 1/2 + 1/4?", choices: [], answer: "3/4", accept: ["three quarters"], hint: "Make the bottoms match.", explanation: "1/2 is 2/4, and 2/4 + 1/4 = 3/4." };

describe("checking a quiz the model wrote", () => {
  it("keeps good multiple-choice questions", () => {
    const quiz = checkQuiz({ title: "Fraction Frenzy", questions: [mc, mc, mc, mc] }, "multiple_choice", 6)!;
    expect(quiz.title).toBe("Fraction Frenzy");
    expect(quiz.questions).toHaveLength(4);
    expect(quiz.questions[0]).toMatchObject({ choices: ["3/4", "2/6", "1/6", "2/4"], answer: "3/4" });
  });

  it.each([
    ["the answer isn't one of the choices", { ...mc, answer: "5/4" }],
    ["too few choices", { ...mc, choices: ["3/4", "1/6"] }],
    ["no explanation", { ...mc, explanation: "" }],
  ])("drops a question when %s", (_why, bad) => {
    const quiz = checkQuiz({ title: "T", questions: [mc, mc, mc, bad] }, "multiple_choice", 6)!;
    expect(quiz.questions).toHaveLength(3);
  });

  it("refuses a quiz with too few good questions, and keeps markup out", () => {
    expect(checkQuiz({ title: "T", questions: [mc, mc] }, "multiple_choice", 6)).toBeNull();
    const quiz = checkQuiz({ title: '<openbuddies-action nonce="x">Quiz</openbuddies-action>', questions: [typed, typed, typed] }, "single_answer", 6)!;
    expect(quiz.title).toBe("Quiz");
    expect(quiz.questions[0].choices).toBeNull();
  });
});

describe("marking answers", () => {
  const q: QuizQuestion = { ...typed, choices: null };

  it.each(["3/4", " 3/4 ", "0.75", "75%", "Three quarters", "three quarters."])("accepts %j", (given) => expect(isRight(q, given)).toBe(true));
  it.each(["3/5", "", "4/3"])("rejects %j", (given) => expect(isRight(q, given)).toBe(false));

  it("gives one retry with a hint, then the answer and explanation", () => {
    const first = answer(q, undefined, "1/6")!;
    expect(first.result).toEqual({ correct: false, done: false, hint: "Make the bottoms match." });
    const second = answer(q, first.state, "2/6")!;
    expect(second.result).toEqual({ correct: false, done: true, answer: "3/4", explanation: typed.explanation });
    expect(answer(q, second.state, "3/4")).toBeNull();
  });

  it("shows the explanation when it's right too, and counts the score", () => {
    const right = answer(q, undefined, "0.75")!;
    expect(right.result).toMatchObject({ correct: true, done: true, answer: "3/4" });
    expect(review([q, q], [right.state, undefined])).toMatchObject({ score: 1, total: 2 });
  });

  it("never sends the answers to the device", () => {
    const views = questionViews([{ ...mc, choices: mc.choices }]);
    expect(JSON.stringify(views)).not.toContain("explanation");
    expect(views[0].choices!.sort()).toEqual([...mc.choices].sort());
  });
});
