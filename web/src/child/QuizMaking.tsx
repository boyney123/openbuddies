// While the buddy writes a quiz: a desk in the chat where question cards are dealt onto a pile one after another. Each
// card writes itself (the question, then its choices) with a pencil scribbling over it, and the right answer gets a
// tick. A dot per question fills in along the top, question marks and ticks float up, and the buddy thinks hard in the
// corner, with a line underneath saying what it's up to.

import { useEffect, useState } from "react";
import { BuddyFace } from "@/components/brand";
import { cn } from "@/lib/utils";
import type { Buddy } from "../../../src/shared/protocol";

/** How long each card takes to write. */
const CARD_MS = 2600;

const LINES = ["Thinking up questions…", "Writing them down…", "Mixing up the choices…", "Checking the answers…", "Adding the explanations…", "Nearly ready…"];

const FLOATERS = [
  { text: "?", left: "6%", delay: 0 },
  { text: "✓", left: "84%", delay: 900 },
  { text: "A", left: "16%", delay: 1800 },
  { text: "!", left: "74%", delay: 2700 },
  { text: "?", left: "90%", delay: 3300 },
];

/** A card's lines and choices; the one card being written draws them in, the ones on the pile are already done. */
function Card({ n, writing }: { n: number; writing: boolean }) {
  const right = (n * 3 + 1) % 4;
  const draw = (delay: number) => (writing ? { className: "animate-quiz-write", style: { animationDelay: `${delay}s` } } : {});
  return (
    <svg viewBox="0 0 100 82" className="size-full" aria-hidden>
      <rect x="6" y="6" width="30" height="12" rx="6" fill="var(--buddy)" />
      <text x="21" y="14.6" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="var(--buddy-on)">
        Q{n + 1}
      </text>
      <g stroke="currentColor" strokeLinecap="round" fill="none" className="text-heading/70">
        <path d="M8 28H90" strokeWidth="3.5" pathLength={1} strokeDasharray="1" {...draw(0.2)} />
        <path d="M8 36H64" strokeWidth="3.5" pathLength={1} strokeDasharray="1" {...draw(0.55)} />
      </g>
      {[0, 1, 2, 3].map((i) => {
        const y = 48 + i * 9;
        const ticked = i === right;
        return (
          <g key={i} className={cn(writing && "animate-in fade-in fill-mode-both")} style={writing ? { animationDelay: `${0.9 + i * 0.18}s` } : undefined}>
            <circle cx="12" cy={y} r="3.4" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/60" />
            <path d={`M20 ${y}H${[62, 48, 70, 54][(i + n) % 4]}`} stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-muted-foreground/40" />
            {ticked && (
              <g className={cn(writing && "animate-quiz-tick")} style={{ transformBox: "fill-box", transformOrigin: "center", animationDelay: writing ? "1.8s" : undefined }}>
                <circle cx="12" cy={y} r="4.6" fill="#34C98A" />
                <path d={`M9.6 ${y}l1.7 1.8 3.2-3.4`} stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function QuizMaking({ buddy, topic, count }: { buddy: Buddy; topic: string; count: number }) {
  const total = Math.max(1, Math.min(count, 10));
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => s + 1), CARD_MS);
    return () => clearInterval(t);
  }, []);
  const n = step % total;
  const line = LINES[Math.min(Math.floor((step * LINES.length) / (total + 1)), LINES.length - 1)];

  return (
    <div className="flex w-full max-w-[88%] flex-col gap-2" role="status" aria-live="polite" aria-label={`${buddy.name} is making your quiz about ${topic}`}>
      <div className="relative aspect-[5/4] w-full overflow-hidden rounded-3xl border-4 border-card bg-buddy-soft shadow-lg">
        {/* A dotted desk. */}
        <div className="absolute inset-0 opacity-50 [background-image:radial-gradient(color-mix(in_oklab,var(--buddy)_35%,transparent)_1.2px,transparent_1.2px)] [background-size:16px_16px]" aria-hidden />

        {/* A dot per question, filling in as they're written. */}
        <div className="absolute top-3 left-1/2 flex -translate-x-1/2 gap-1.5" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={cn("size-2.5 rounded-full transition-colors duration-500", i < n ? "bg-buddy" : i === n ? "animate-pulse bg-buddy" : "bg-buddy/25")} />
          ))}
        </div>

        {FLOATERS.map((f, i) => (
          <span
            key={i}
            className="absolute bottom-2 flex size-7 animate-quiz-float items-center justify-center rounded-full bg-card text-sm font-extrabold text-buddy-strong shadow"
            style={{ left: f.left, animationDelay: `${f.delay}ms` }}
            aria-hidden
          >
            {f.text}
          </span>
        ))}

        {/* The pile of cards, with the one being written dealt on top. */}
        <div className="absolute top-[16%] left-1/2 aspect-[100/82] w-[60%] -translate-x-1/2">
          {n > 1 && (
            <div className="absolute inset-0 -rotate-6 rounded-2xl bg-card p-1 opacity-80 shadow ring-1 ring-border">
              <Card n={n - 2} writing={false} />
            </div>
          )}
          {n > 0 && (
            <div className="absolute inset-0 rotate-3 rounded-2xl bg-card p-1 opacity-90 shadow ring-1 ring-border">
              <Card n={n - 1} writing={false} />
            </div>
          )}
          <div key={step} className="absolute inset-0 animate-quiz-deal rounded-2xl bg-card p-1 shadow-lg ring-1 ring-border">
            <Card n={n} writing />
          </div>
          {/* The pencil, scribbling over the card. */}
          <div key={`p${step}`} className="pointer-events-none absolute inset-0 animate-quiz-pencil" aria-hidden>
            <svg viewBox="0 0 30 90" className="h-[70%] -translate-y-full drop-shadow-md" style={{ transform: "rotate(28deg)", transformOrigin: "0 100%" }}>
              <path d="M9 74L15 88L21 74Z" fill="#F6D7A8" stroke="#102A5C" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M13.2 84L15 88L16.8 84Z" fill="#102A5C" />
              <rect x="9" y="16" width="12" height="58" fill="#FFB020" stroke="#102A5C" strokeWidth="2.5" />
              <rect x="9" y="8" width="12" height="9" fill="#C9D6EE" stroke="#102A5C" strokeWidth="2.5" />
              <rect x="9" y="1.5" width="12" height="7.5" rx="3.5" fill="#FF6B5E" stroke="#102A5C" strokeWidth="2.5" />
            </svg>
          </div>
        </div>

        {/* The buddy, thinking hard in the corner. */}
        <div className="absolute right-3 bottom-3 animate-float">
          <BuddyFace color={buddy.color} wear={buddy.wear} mood="thinking" className="size-16 drop-shadow" title={buddy.name} star={buddy.main} />
        </div>
      </div>
      <p className="px-1 text-sm">
        <span className="font-bold text-heading">
          {buddy.name} is making your quiz about {topic}
        </span>
        <span key={line} className="ml-1.5 inline-block animate-in text-muted-foreground fade-in slide-in-from-bottom-1 duration-300">
          {line}
        </span>
      </p>
    </div>
  );
}
