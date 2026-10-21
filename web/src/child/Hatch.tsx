import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Volume2Icon, VolumeXIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BuddyFace, buddyVars } from "@/components/brand";
import { Button } from "@/components/ui/button";
import type { Buddy } from "../../../src/shared/protocol";
import { crack, hatch, setSoundOn, soundOn, wobbleTaps } from "./sounds";

type Phase = "wobble" | "crack" | "hatch" | "done";

// When each phase starts, in ms from the splash opening.
const TIMELINE: [Phase, number][] = [
  ["crack", 1700],
  ["hatch", 2300],
  ["done", 3100],
];
// The egg's swings in its two wobbles (see egg-wobble in styles.css), in seconds, for the tapping sounds.
const SWINGS = [0, 0.85].flatMap((start) => [0.13, 0.26, 0.38, 0.51].map((s) => start + s));

// The crack runs across the middle of the egg (viewBox 0 0 120 150).
const CRACK = "12,84 24,74 36,86 48,72 60,86 72,72 84,86 96,74 108,84";
const EGG = "M60 6C90 6 110 58 110 94C110 124 88 144 60 144C32 144 10 124 10 94C10 58 30 6 60 6Z";

export const CONFETTI = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2 + (i % 2) * 0.2;
  const reach = 110 + (i % 3) * 35;
  return {
    dx: Math.cos(angle) * reach,
    dy: Math.sin(angle) * reach - 30,
    color: ["var(--buddy)", "#FF6B5E", "#FFB020", "#34C98A", "#2F80FF"][i % 5],
    shape: i % 3,
    delay: (i % 4) * 40,
  };
});

function Egg({ phase }: { phase: Phase }) {
  const shell = (clip: string, className: string) => (
    <g clipPath={`url(#${clip})`} className={className}>
      <path d={EGG} fill="#FFF8EC" />
      <circle cx="40" cy="44" r="8" className="fill-buddy" opacity="0.8" />
      <circle cx="78" cy="62" r="11" className="fill-buddy" opacity="0.8" />
      <circle cx="52" cy="110" r="10" className="fill-buddy" opacity="0.8" />
      <circle cx="86" cy="116" r="6" className="fill-buddy" opacity="0.8" />
      <circle cx="30" cy="96" r="5" className="fill-buddy" opacity="0.8" />
      <path d={EGG} fill="none" stroke="#102A5C" strokeWidth="5" />
    </g>
  );
  const hatched = phase === "hatch" || phase === "done";
  return (
    <svg viewBox="0 0 120 150" className="absolute inset-0 size-full overflow-visible" aria-hidden>
      <defs>
        <clipPath id="egg-top">
          <polygon points={`0,0 120,0 120,84 ${CRACK.split(" ").reverse().join(" ")} 0,84`} />
        </clipPath>
        <clipPath id="egg-bottom">
          <polygon points={`0,150 120,150 120,84 ${CRACK.split(" ").reverse().join(" ")} 0,84`} />
        </clipPath>
      </defs>
      {shell("egg-bottom", cn("origin-[60px_120px] [transform-box:view-box]", hatched && "animate-shell-drop"))}
      {shell("egg-top", cn("origin-[60px_60px] [transform-box:view-box]", hatched && "animate-shell-fly"))}
      {phase === "crack" && <polyline points={CRACK} fill="none" stroke="#102A5C" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" className="animate-crack" pathLength={1} />}
    </svg>
  );
}

/**
 * A full-screen welcome for a new buddy: an egg in its colour wobbles, cracks and hatches, the buddy pops out to
 * confetti, then its name and what it's like appear above `children` (the buttons).
 */
export function HatchSplash({ buddy, subject, children }: { buddy: Buddy; subject: string | null; children: ReactNode }) {
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [phase, setPhase] = useState<Phase>(reduced ? "done" : "wobble");
  const [sound, setSound] = useState(soundOn);
  useEffect(() => {
    if (reduced) return;
    const timers = TIMELINE.map(([p, at]) => setTimeout(() => setPhase(p), at));
    return () => timers.forEach(clearTimeout);
  }, [reduced]);
  // Sounds follow the phases: taps while it rocks, a crack, then a bloop and a chime as the buddy pops out.
  useEffect(() => {
    if (phase === "wobble") wobbleTaps(SWINGS);
    else if (phase === "crack") crack();
    else if (phase === "hatch" || (phase === "done" && reduced)) hatch();
  }, [phase, reduced]);
  const out = phase === "hatch" || phase === "done";

  return (
    <main className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-background px-6 pb-[max(24px,env(safe-area-inset-bottom))]" style={buddyVars(buddy.color)}>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-[max(12px,env(safe-area-inset-top))] right-3 z-10 rounded-full"
        aria-label={sound ? "Turn sound off" : "Turn sound on"}
        onClick={() => {
          setSoundOn(!sound);
          setSound(!sound);
        }}
      >
        {sound ? <Volume2Icon /> : <VolumeXIcon />}
      </Button>

      <div className="relative flex size-56 items-center justify-center">
        {/* A slow sunburst in the buddy's colour, centred on the egg. */}
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 size-[200vmax] -translate-x-1/2 -translate-y-1/2 animate-[spin_40s_linear_infinite] opacity-50 [mask-image:radial-gradient(circle,black_4%,transparent_22%)]"
          style={{ background: "repeating-conic-gradient(color-mix(in oklab, var(--buddy) 22%, transparent) 0 9deg, transparent 9deg 18deg)" }}
          aria-hidden
        />
        {!out || phase === "hatch" ? (
          <div className={cn("absolute inset-x-6 inset-y-0", phase === "wobble" && "animate-egg-wobble", phase === "crack" && "animate-egg-shake")} style={{ transformOrigin: "50% 90%" }}>
            <Egg phase={phase} />
          </div>
        ) : null}
        {out && (
          <>
            {CONFETTI.map((c, i) => (
              <span
                key={i}
                className={cn("absolute top-1/2 left-1/2 animate-confetti", c.shape === 0 ? "size-3 rounded-full" : c.shape === 1 ? "h-2 w-4 rounded-sm" : "size-3 rotate-45 rounded-[2px]")}
                style={{ background: c.color, "--dx": `${c.dx}px`, "--dy": `${c.dy}px`, animationDelay: `${c.delay}ms` } as CSSProperties}
                aria-hidden
              />
            ))}
            <div className="relative animate-hatch-pop">
              <BuddyFace color={buddy.color} wear={buddy.wear} mood="happy" motion={phase === "done" ? "float" : "none"} className="size-40" title={buddy.name} star={buddy.main} />
            </div>
          </>
        )}
      </div>

      <div className={cn("relative mt-6 flex w-full max-w-sm flex-col items-center gap-2 text-center transition-all duration-500", phase === "done" ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")}>
        <p className="text-sm font-bold tracking-wide text-buddy-strong uppercase">It's hatched!</p>
        <h1 className="text-4xl">Meet {buddy.name}!</h1>
        {buddy.description && <p className="text-lg text-muted-foreground">{buddy.description}</p>}
        {subject && <span className="rounded-full bg-buddy-soft px-3 py-1 text-sm font-semibold">Best at {subject}</span>}
        <div className="mt-4 flex w-full flex-col gap-2" aria-hidden={phase !== "done"}>
          {children}
        </div>
      </div>
    </main>
  );
}
