// The Quizzes app: the quizzes a buddy has made for the child, and taking them. Children ask for a quiz in a chat
// ("make me a quiz about volcanoes"); it appears here when it's ready. Answers are checked by the server: one retry per
// question (with a hint), then the answer and why.

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { CheckIcon, ChevronRightIcon, LoaderCircleIcon, RotateCcwIcon, Trash2Icon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BuddyFace, type BuddyMood } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Buddy, QuizAnswerResult, QuizQuestionView, QuizReview, QuizSummary } from "../../../src/shared/protocol";
import { answerQuiz, deleteQuiz, finishQuiz, listQuizzes, startQuiz } from "./files";
import { CONFETTI } from "./Hatch";
import { Hills } from "./BuddyStage";
import { gotIt } from "./sounds";
import { TopBar } from "./TopBar";

const styleName = (s: QuizSummary["style"]) => (s === "multiple_choice" ? "Multiple choice" : s === "single_answer" ? "Type the answers" : "");

/** The buddy's quizzes: take or retake one, or ask the buddy for a new one (in the chat). */
export function QuizzesPage({ buddy, version, onBack, onTake, onMake }: { buddy: Buddy; version: number; onBack: () => void; onTake: (id: number) => void; onMake: () => void }) {
  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  useEffect(() => {
    listQuizzes(buddy.id).then(setQuizzes, () => setQuizzes([]));
  }, [buddy.id, version]);
  const remove = (q: QuizSummary) => {
    if (!confirm(`Delete "${q.title}"?`)) return;
    deleteQuiz(q.id).then(() => setQuizzes((list) => list?.filter((x) => x.id !== q.id) ?? null), () => {});
  };
  return (
    <main className="mx-auto min-h-dvh max-w-md pb-[max(24px,env(safe-area-inset-bottom))]">
      <TopBar title={`${buddy.name}'s quizzes`} onBack={onBack} />
      <div className="flex flex-col gap-4 px-4 pt-1">
        <QuizzesHello buddy={buddy} quizzes={quizzes} onMake={onMake} />
        {!quizzes ? (
          <p className="py-6 text-center text-muted-foreground">Loading…</p>
        ) : quizzes.length === 0 ? (
          <p className="rounded-3xl border border-dashed px-5 py-8 text-center text-muted-foreground">No quizzes yet. Your first one is just a message away!</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {quizzes.map((q) => (
              <li key={q.id} className="card-buddy flex items-center gap-3 rounded-3xl p-3">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-buddy-soft text-sm font-extrabold text-buddy-strong">
                  {q.status === "ready" ? (q.best ? `${q.best.score}/${q.best.total}` : q.count) : <LoaderCircleIcon className="size-5 animate-spin" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold text-heading">{q.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {q.status === "ready"
                      ? `${q.count} questions · ${styleName(q.style)}${q.attempts ? ` · taken ${q.attempts}×` : ""}`
                      : q.status === "offered"
                        ? "Pick multiple choice or typed answers in Chat"
                        : `${buddy.name} is making it…`}
                  </div>
                </div>
                {q.status === "ready" && (
                  <Button size="sm" className="shrink-0 rounded-full bg-buddy px-4 text-buddy-on hover:bg-buddy/90" onClick={() => onTake(q.id)}>
                    {q.attempts ? "Retake" : "Take"}
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="shrink-0 rounded-full text-muted-foreground hover:text-destructive" onClick={() => remove(q)} aria-label={`Delete ${q.title}`}>
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

const ANOTHER = [
  "Fancy another quiz? I can make one about anything you're learning!",
  "Want me to make you a new quiz? Pick any topic!",
  "Ready for a new challenge? I'll make you a quiz!",
];

/** The buddy at the top of the page, on its hills, asking if the child wants a quiz (or saying it's making one). */
function QuizzesHello({ buddy, quizzes, onMake }: { buddy: Buddy; quizzes: QuizSummary[] | null; onMake: () => void }) {
  const [another] = useState(() => ANOTHER[Math.floor(Math.random() * ANOTHER.length)]);
  const making = quizzes?.find((q) => q.status === "making");
  const offered = quizzes?.find((q) => q.status === "offered");
  const say = making
    ? `I'm making your quiz about ${making.title} right now! It'll pop up here when it's ready.`
    : offered
      ? `Shall I make that quiz about ${offered.title}? Pick multiple choice or typed answers in our chat!`
      : quizzes?.length
        ? another
        : "Hi! Do you want me to help you make a quiz? It can be about anything you're learning.";
  return (
    <section className="relative flex min-h-44 items-center gap-1 overflow-hidden rounded-3xl bg-buddy-soft px-3 pt-4 pb-6" aria-label={`${buddy.name} says`}>
      <Hills />
      <span className={cn("relative shrink-0 self-end", making ? "animate-float" : "animate-pop")}>
        <BuddyFace color={buddy.color} wear={buddy.wear} mood={making ? "thinking" : "happy"} className="size-24" title={buddy.name} star={buddy.main} />
      </span>
      <div className="relative ml-2 min-w-0 flex-1 animate-in self-start fade-in slide-in-from-left-2 duration-500">
        <span className="absolute top-6 -left-1.5 size-4 rotate-45 rounded-[3px] bg-buddy" aria-hidden />
        <div className="relative rounded-3xl bg-buddy px-4 py-3 text-buddy-on">
          <p className="text-[15px] leading-snug font-semibold">{quizzes ? say : "Let me find your quizzes…"}</p>
          {quizzes && !making && (
            <Button size="sm" className="mt-2.5 h-9 rounded-full bg-card px-4 font-bold text-heading hover:bg-card/90" onClick={onMake}>
              {offered ? "Go to chat" : "Yes please!"}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

interface Turn {
  tries: string[];
  result: QuizAnswerResult | null;
}

/** Taking a quiz: one question at a time, one retry each, then the results. */
export function QuizPlayer({ buddy, quizId, onBack }: { buddy: Buddy; quizId: number; onBack: () => void }) {
  const [quiz, setQuiz] = useState<{ attemptId: number; title: string; questions: QuizQuestionView[] } | null>(null);
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<QuizReview | null>(null);
  const start = () => {
    setQuiz(null);
    setResults(null);
    setN(0);
    setTurns([]);
    setTyped("");
    startQuiz(quizId).then((q) => (setQuiz(q), setTurns(q.questions.map(() => ({ tries: [], result: null })))), (e) => setError((e as Error).message));
  };
  useEffect(start, [quizId]);

  if (error) {
    return (
      <main className="mx-auto min-h-dvh max-w-md">
        <TopBar title="Quiz" onBack={onBack} />
        <p className="px-6 py-10 text-center text-muted-foreground">{error}</p>
      </main>
    );
  }
  if (!quiz) {
    return (
      <main className="mx-auto min-h-dvh max-w-md">
        <TopBar title="Quiz" onBack={onBack} />
        <p className="py-10 text-center text-muted-foreground">Getting your quiz ready…</p>
      </main>
    );
  }
  if (results) return <QuizResults buddy={buddy} title={quiz.title} results={results} onRetake={start} onBack={onBack} />;

  const q = quiz.questions[n];
  const turn = turns[n] ?? { tries: [], result: null };
  const done = !!turn.result?.done;
  const last = n === quiz.questions.length - 1;
  const mood: BuddyMood = !turn.result ? "idle" : turn.result.correct ? "happy" : done ? "look" : "thinking";

  const submit = async (given: string) => {
    if (busy || done || !given.trim()) return;
    setBusy(true);
    try {
      const result = await answerQuiz(quiz.attemptId, n, given);
      if (result.correct) gotIt();
      setTurns((ts) => ts.map((t, i) => (i === n ? { tries: [...t.tries, given], result } : t)));
      setTyped("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const next = async () => {
    if (!last) return setN(n + 1);
    setBusy(true);
    finishQuiz(quiz.attemptId).then(setResults, (e) => setError((e as Error).message)).finally(() => setBusy(false));
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col pb-[max(20px,env(safe-area-inset-bottom))]">
      <TopBar title={quiz.title} onBack={onBack} />
      <div className="flex flex-1 flex-col gap-5 px-5 pt-2">
        {/* Progress. */}
        <div className="flex items-center gap-3">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-buddy-soft">
            <div className="h-full rounded-full bg-buddy transition-[width] duration-500" style={{ width: `${((n + (done ? 1 : 0)) / quiz.questions.length) * 100}%` }} />
          </div>
          <span className="text-sm font-bold text-muted-foreground tabular-nums">
            {n + 1}/{quiz.questions.length}
          </span>
        </div>

        <div className="flex items-start gap-3">
          <BuddyFace key={`${n}-${turn.tries.length}`} color={buddy.color} wear={buddy.wear} mood={mood} motion={turn.result?.correct ? "hop" : "none"} className="size-14 shrink-0" title={buddy.name} />
          <h2 key={n} className="animate-in pt-1 text-xl leading-snug fade-in slide-in-from-right-2 duration-300">
            {q.question}
          </h2>
        </div>

        {q.choices ? (
          <div className="flex flex-col gap-2">
            {q.choices.map((c) => {
              const tried = turn.tries.includes(c);
              const right = done && c === turn.result?.answer;
              const wrong = tried && !right;
              return (
                <button
                  key={c}
                  disabled={busy || done || tried}
                  onClick={() => submit(c)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border-2 bg-card px-4 py-3.5 text-left text-[17px] font-semibold transition-colors active:scale-[0.99]",
                    right ? "border-mint bg-mint-soft" : wrong ? "border-coral/60 bg-coral-soft opacity-80" : "border-transparent hover:border-buddy/40",
                  )}
                >
                  <span className="min-w-0 flex-1">{c}</span>
                  {right && <CheckIcon className="size-5 shrink-0 text-mint" />}
                  {wrong && <XIcon className="size-5 shrink-0 text-coral" />}
                </button>
              );
            })}
          </div>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void submit(typed);
            }}
          >
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy || done}
              placeholder={done ? "" : turn.tries.length ? "Have another go…" : "Your answer"}
              className="h-14 rounded-2xl bg-card text-lg"
              autoFocus
              aria-label="Your answer"
            />
            {!done && (
              <Button type="submit" className="h-14 rounded-2xl bg-buddy px-5 text-base font-semibold text-buddy-on hover:bg-buddy/90" disabled={busy || !typed.trim()}>
                Check
              </Button>
            )}
          </form>
        )}

        {/* What happened: try again (with a hint), or the answer and why. */}
        {turn.result && !done && (
          <div className="animate-in rounded-2xl bg-sunny-soft px-4 py-3 fade-in slide-in-from-bottom-1">
            <p className="font-bold text-heading">Not quite! Have one more go.</p>
            {turn.result.hint && <p className="mt-0.5 text-sm">Hint: {turn.result.hint}</p>}
          </div>
        )}
        {done && (
          <div className={cn("animate-in rounded-2xl px-4 py-3 fade-in slide-in-from-bottom-1", turn.result!.correct ? "bg-mint-soft" : "bg-buddy-soft")}>
            <p className="font-bold text-heading">{turn.result!.correct ? "That's right!" : `The answer is ${turn.result!.answer}.`}</p>
            {turn.result!.explanation && <p className="mt-0.5 text-sm leading-relaxed">{turn.result!.explanation}</p>}
          </div>
        )}

        <div className="mt-auto">
          {done && (
            <Button className="h-14 w-full rounded-2xl bg-buddy text-lg font-bold text-buddy-on hover:bg-buddy/90" onClick={next} disabled={busy}>
              {last ? "See my score" : "Next question"} <ChevronRightIcon className="size-5" />
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}

/** How it went: the score, every question with the right answer, and a retake. */
function QuizResults({ buddy, title, results, onRetake, onBack }: { buddy: Buddy; title: string; results: QuizReview; onRetake: () => void; onBack: () => void }) {
  const full = results.score === results.total;
  const good = results.score / Math.max(1, results.total) >= 0.6;
  return (
    <main className="mx-auto min-h-dvh max-w-md pb-[max(24px,env(safe-area-inset-bottom))]">
      <TopBar title={title} onBack={onBack} />
      <div className="flex flex-col gap-5 px-5 pt-2">
        <section className="relative flex flex-col items-center gap-2 overflow-visible rounded-3xl bg-buddy-soft px-4 py-6 text-center">
          {full &&
            CONFETTI.map((c, i) => (
              <span
                key={i}
                className={cn("absolute top-16 left-1/2 animate-confetti", c.shape === 0 ? "size-3 rounded-full" : c.shape === 1 ? "h-2 w-4 rounded-sm" : "size-3 rotate-45 rounded-[2px]")}
                style={{ background: c.color, "--dx": `${c.dx}px`, "--dy": `${c.dy}px`, animationDelay: `${c.delay}ms` } as CSSProperties}
                aria-hidden
              />
            ))}
          <BuddyFace color={buddy.color} wear={buddy.wear} mood={good ? "happy" : "idle"} motion={good ? "hop" : "float"} className="size-20" title={buddy.name} />
          <p className="text-5xl font-extrabold text-heading tabular-nums">
            {results.score}/{results.total}
          </p>
          <p className="font-semibold text-muted-foreground">
            {full ? "Full marks! Amazing!" : good ? "Great work! Have another go to beat it?" : "Good effort! Every try helps you learn."}
          </p>
        </section>

        <ul className="flex flex-col gap-2">
          {results.questions.map((q, i) => (
            <li key={i} className="card-buddy flex gap-3 rounded-3xl p-4">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", q.correct ? "bg-mint-soft text-mint" : "bg-coral-soft text-coral")}>
                {q.correct ? <CheckIcon className="size-4" /> : <XIcon className="size-4" />}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-heading">{q.question}</p>
                <p className="mt-0.5 text-sm">
                  Answer: <span className="font-semibold">{q.answer}</span>
                  {!q.correct && q.tries.length > 0 && <span className="text-muted-foreground"> (you said {q.tries.join(", then ")})</span>}
                </p>
                {!q.correct && <p className="mt-1 text-sm text-muted-foreground">{q.explanation}</p>}
              </div>
            </li>
          ))}
        </ul>

        <div className="grid grid-cols-2 gap-2">
          <Button className="h-12 rounded-2xl bg-buddy font-semibold text-buddy-on hover:bg-buddy/90" onClick={onRetake}>
            <RotateCcwIcon /> Retake
          </Button>
          <Button variant="secondary" className="h-12 rounded-2xl font-semibold" onClick={onBack}>
            My quizzes
          </Button>
        </div>
      </div>
    </main>
  );
}
