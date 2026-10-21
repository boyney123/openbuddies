// While Picture Studio makes a picture: a big square canvas in the chat where the buddy is painting. Strokes in the
// buddy's and the brand's colours paint themselves in, a brush sweeps over them, sparkles twinkle, and the buddy bobs
// along in the corner, with a line underneath saying what it's up to.

import { useEffect, useState } from "react";
import { BuddyFace } from "@/components/brand";
import type { Buddy } from "../../../src/shared/protocol";

/** Strokes on a 100x100 canvas, painted in turn. `d` is the path, then its colour and width. */
const STROKES: [string, string, number][] = [
  ["M8 78 Q30 60 50 74 T92 70", "#34C98A", 9],
  ["M14 22 Q36 8 58 20 T90 26", "#2F80FF", 7],
  ["M70 34 m-10 0 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0", "#FFB020", 6],
  ["M22 52 Q34 34 46 50 T70 48", "var(--buddy)", 8],
  ["M30 88 Q50 80 70 90", "#FF6B5E", 6],
  ["M12 40 L20 30 L28 40 L36 30", "#8B5CF6", 4],
];

const SPARKLES = [
  { x: "14%", y: "16%", d: 0 },
  { x: "80%", y: "14%", d: 600 },
  { x: "72%", y: "78%", d: 1100 },
  { x: "24%", y: "70%", d: 1600 },
];

const LINES = ["Mixing the colours…", "Sketching it out…", "Painting the big shapes…", "Adding the details…", "A little sparkle…", "Nearly there…"];

export function PaintingCanvas({ buddy, title }: { buddy: Buddy; title: string }) {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLine((l) => (l + 1) % LINES.length), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex w-full max-w-[88%] flex-col gap-2" role="status" aria-live="polite" aria-label={`${buddy.name} is painting ${title}`}>
      <div className="relative aspect-square w-full overflow-hidden rounded-3xl border-4 border-card bg-[#FFFBF3] shadow-lg dark:bg-[#1d2638]">
        {/* Paper grain. */}
        <div className="absolute inset-0 opacity-40 [background:radial-gradient(circle_at_30%_20%,color-mix(in_oklab,var(--buddy)_10%,transparent),transparent_60%)]" aria-hidden />
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
          {STROKES.map(([d, color, width], i) => (
            <path
              key={i}
              d={d}
              pathLength={1}
              fill="none"
              stroke={color}
              strokeWidth={width}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="1"
              className="animate-paint-stroke"
              style={{ animationDelay: `${i * 0.75}s` }}
            />
          ))}
        </svg>
        {SPARKLES.map((s, i) => (
          <svg key={i} viewBox="0 0 24 24" className="absolute size-6 animate-twinkle text-sunny" style={{ left: s.x, top: s.y, animationDelay: `${s.d}ms` }} aria-hidden>
            <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" fill="currentColor" />
          </svg>
        ))}
        {/* The brush, sweeping over the canvas. */}
        <div className="absolute inset-0 animate-paint-brush" aria-hidden>
          <svg viewBox="0 0 40 120" className="h-[38%] drop-shadow-md">
            <rect x="15" y="40" width="10" height="70" rx="5" fill="#FFB020" stroke="#102A5C" strokeWidth="3" />
            <rect x="13" y="30" width="14" height="14" rx="2" fill="#C9D6EE" stroke="#102A5C" strokeWidth="3" />
            <path d="M13 32 Q20 0 27 32 Z" fill="var(--buddy)" stroke="#102A5C" strokeWidth="3" strokeLinejoin="round" />
          </svg>
        </div>
        {/* The buddy, bobbing along in the corner. */}
        <div className="absolute right-3 bottom-3 animate-float">
          <BuddyFace color={buddy.color} wear={buddy.wear} mood="thinking" className="size-16 drop-shadow" title={buddy.name} star={buddy.main} />
        </div>
      </div>
      <p className="px-1 text-sm">
        <span className="font-bold text-heading">
          {buddy.name} is painting "{title}"
        </span>
        <span key={line} className="ml-1.5 inline-block animate-in text-muted-foreground fade-in slide-in-from-bottom-1 duration-300">
          {LINES[line]}
        </span>
      </p>
    </div>
  );
}
