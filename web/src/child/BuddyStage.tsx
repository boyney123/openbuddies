// The top of the child's home screen: their buddy, out and about. With nothing to say it wanders, hops, looks around
// and has a little rest, like it's alive. Now and then, when it (or another buddy) has something to tell the child, it
// stops and says so in a small bubble with a bell, a one-line summary; a bell over its head shows there's news in
// between. When the child switches to it, it says hello first. Tap the buddy to switch buddies.

import { useEffect, useRef, useState } from "react";
import { BellIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BuddyFace, type BuddyMood, type BuddyMotion } from "@/components/brand";
import type { Buddy, Nudge, SubjectOption } from "../../../src/shared/protocol";
import { subjectName } from "./Buddies";
import { buddyGreeting, buddyVoice } from "./greetings";
import { PaintButton } from "./Wardrobe";

const NUDGE_LABEL: Record<Nudge["kind"], string> = { reminder: "Reminder", plan: "Your plan", checkin: "Checking in" };

/** How long the buddy says something for, and how often it brings up news it's holding. */
const SAY_MS = 8000;
const HELLO_MS = 4200;
const NEWS_EVERY_MS = 30_000;

/** The buddy's width on the stage, with its padding (size-24 plus p-1). */
const BUDDY_PX = 104;

/**
 * A little landscape for the buddy to wander in: two rolling hills in shades of its colour (so they change with the
 * buddy's theme), a few round trees on the far hill, and two clouds drifting over.
 */
export function Hills() {
  const far = "color-mix(in oklab, var(--buddy) 18%, var(--background))";
  const near = "color-mix(in oklab, var(--buddy) 32%, var(--background))";
  const trunk = "color-mix(in oklab, var(--buddy) 45%, var(--heading))";
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-b-3xl" aria-hidden>
      {/* Clouds, drifting slowly. */}
      {[
        { top: "10%", width: 54, dur: "38s", delay: "-6s" },
        { top: "28%", width: 38, dur: "52s", delay: "-30s" },
      ].map((c, i) => (
        <svg key={i} viewBox="0 0 60 24" className="absolute animate-[cloud-drift_var(--dur)_linear_infinite]" style={{ top: c.top, width: c.width, animationDelay: c.delay, "--dur": c.dur } as React.CSSProperties}>
          <path d="M14 22H48Q58 22 58 15Q58 8 50 8Q48 1 39 2Q33 -2 26 4Q17 2 15 10Q6 10 6 16Q6 22 14 22Z" className="fill-white/80 dark:fill-white/15" />
        </svg>
      ))}
      <svg viewBox="0 0 400 60" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-16 w-full">
        {/* The far hill, then the near one the buddy walks on. */}
        <path d="M0 30Q70 6 150 22T300 16T400 22V60H0Z" fill={far} />
        <path d="M0 44Q100 30 210 40T400 36V60H0Z" fill={near} />
      </svg>
      {/* Round trees on the far hill. */}
      {[
        { left: "14%", bottom: 38, size: 18 },
        { left: "19%", bottom: 36, size: 13 },
        { left: "78%", bottom: 40, size: 16 },
      ].map((t, i) => (
        <svg key={i} viewBox="0 0 20 28" className="absolute" style={{ left: t.left, bottom: t.bottom, width: t.size }}>
          <rect x="9" y="16" width="2.5" height="12" rx="1.2" fill={trunk} />
          <circle cx="10" cy="10" r="9" fill={near} />
        </svg>
      ))}
    </div>
  );
}

/** The first sentence, short enough for one or two lines. */
function summary(text: string): string {
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return first.length > 80 ? `${first.slice(0, 77).trimEnd()}…` : first;
}

type Act = { mood: BuddyMood; motion: BuddyMotion; x?: number; rest?: boolean };

/** The buddy's next thing to do when it has nothing to say. */
function nextAct(x: number): Act {
  const r = Math.random();
  if (r < 0.45) {
    // Wander somewhere new, not too close to where it is.
    let to = Math.random();
    if (Math.abs(to - x) < 0.25) to = to > 0.5 ? to - 0.35 : to + 0.35;
    return { mood: "idle", motion: "hop", x: Math.min(1, Math.max(0, to)) };
  }
  if (r < 0.6) return { mood: "look", motion: "none" };
  if (r < 0.72) return { mood: "happy", motion: "hop" };
  if (r < 0.82) return { mood: "wink", motion: "wiggle" };
  if (r < 0.92) return { mood: "idle", motion: "none", rest: true };
  return { mood: "thinking", motion: "float" };
}

export function BuddyStage({
  buddy,
  childName,
  subjects,
  nudge,
  other,
  onTap,
  onOpen,
  onDress,
}: {
  buddy: Buddy;
  childName: string;
  subjects: SubjectOption[];
  /** The newest thing this buddy has to tell the child, if any. */
  nudge: Nudge | null;
  /** Another buddy with something to tell, if any. */
  other: Buddy | null;
  onTap: () => void;
  onOpen: (b: Buddy) => void;
  /** The paint button: change how the buddy looks. */
  onDress: () => void;
}) {
  const voice = buddyVoice(buddy, subjectName(subjects, buddy.subject));
  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [x, setX] = useState(0.5);
  const [act, setAct] = useState<Act>({ mood: "happy", motion: "none" });
  const [step, setStep] = useState(0);
  const [facingLeft, setFacingLeft] = useState(false);
  // What it's saying right now: hello after a switch, or news.
  const [saying, setSaying] = useState<"hello" | "news" | null>("hello");
  const xRef = useRef(x);
  xRef.current = x;
  const hasNews = !!(nudge || other);

  // Dragging the buddy around: it follows the finger (surprised!). Let go and it flies on with the throw's speed,
  // falls, bounces along the hills (and off the sides) and slides to a stop.
  const stage = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const grab = useRef<{ px: number; py: number; left: number; top: number; moved: boolean; trail: { t: number; x: number; y: number }[] } | null>(null);
  const [drag, setDrag] = useState<{ left: number; top: number; tilt: number; air?: boolean } | null>(null);
  const [landing, setLanding] = useState(false);
  const flight = useRef(0);
  useEffect(() => () => cancelAnimationFrame(flight.current), []);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!body.current || (e.target as Element).closest("[data-no-drag]")) return;
    cancelAnimationFrame(flight.current);
    body.current.setPointerCapture(e.pointerId);
    grab.current = { px: e.clientX, py: e.clientY, left: body.current.offsetLeft, top: body.current.offsetTop, moved: false, trail: [] };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = grab.current;
    if (!g || !stage.current) return;
    const dx = e.clientX - g.px;
    const dy = e.clientY - g.py;
    // A small wobble is still a tap.
    if (!g.moved && Math.hypot(dx, dy) < 6) return;
    g.moved = true;
    const now = performance.now();
    g.trail = [...g.trail.filter((p) => now - p.t < 100), { t: now, x: e.clientX, y: e.clientY }];
    const width = stage.current.clientWidth - BUDDY_PX;
    setDrag({ left: Math.min(width + 8, Math.max(-8, g.left + dx)), top: Math.min(40, Math.max(-48, g.top + dy)), tilt: Math.max(-14, Math.min(14, e.movementX * 2)) });
  };
  /** Fly from where it was let go, with the throw's speed, until it comes to rest on the hills. */
  const fly = (from: { left: number; top: number }, vx: number, vy: number) => {
    const width = Math.max(1, (stage.current?.clientWidth ?? BUDDY_PX) - BUDDY_PX);
    const ground = 16;
    const gravity = 0.0028;
    let { left, top } = from;
    let last = performance.now();
    const started = last;
    const frame = (now: number) => {
      const dt = Math.min(32, now - last);
      last = now;
      vy += gravity * dt;
      left += vx * dt;
      top += vy * dt;
      if (left < 0 || left > width) {
        left = Math.max(0, Math.min(width, left));
        vx = -vx * 0.55;
      }
      if (top < -70) {
        top = -70;
        vy = Math.abs(vy) * 0.3;
      }
      const onGround = top >= ground;
      if (onGround) {
        top = ground;
        vy = Math.abs(vy) > 0.12 ? -vy * 0.5 : 0;
        vx *= vy === 0 ? 0.9 : 0.85;
      }
      const resting = onGround && vy === 0 && Math.abs(vx) < 0.02;
      if (resting || now - started > 4000) {
        setX(left / width);
        setDrag(null);
        setLanding(true);
        setAct({ mood: "happy", motion: "hop" });
        setStep((n) => n + 1);
        setTimeout(() => setLanding(false), 500);
        return;
      }
      setDrag({ left, top, tilt: Math.max(-20, Math.min(20, vx * 30)), air: !onGround });
      if (vx !== 0) setFacingLeft(vx < 0);
      flight.current = requestAnimationFrame(frame);
    };
    flight.current = requestAnimationFrame(frame);
  };
  const onPointerUp = () => {
    const g = grab.current;
    grab.current = null;
    if (!g) return;
    // Not moved: a tap, which opens the buddy picker.
    if (!g.moved) return onTap();
    if (!drag || !stage.current) return;
    // The throw: how fast the finger was moving over the last moment, in px per ms.
    const [first, latest] = [g.trail[0], g.trail.at(-1)];
    const span = first && latest ? latest.t - first.t : 0;
    const vx = span > 0 ? (latest!.x - first!.x) / span : 0;
    const vy = span > 0 ? (latest!.y - first!.y) / span : 0;
    const cap = (v: number) => Math.max(-2.2, Math.min(2.2, v));
    if (reduced) {
      setX(Math.min(1, Math.max(0, drag.left / Math.max(1, stage.current.clientWidth - BUDDY_PX))));
      setDrag(null);
      return;
    }
    fly({ left: drag.left, top: drag.top }, cap(vx), cap(vy));
  };

  // A new buddy says hello first, with a greeting picked fresh each time.
  const [greeting, setGreeting] = useState(() => buddyGreeting(buddy, subjectName(subjects, buddy.subject), childName));
  useEffect(() => {
    setGreeting(buddyGreeting(buddy, subjectName(subjects, buddy.subject), childName));
    setSaying("hello");
    setX(0);
    const t = setTimeout(() => setSaying(null), HELLO_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buddy.id]);

  // News comes up soon after it arrives, then every so often while it's unseen.
  useEffect(() => {
    if (!hasNews) return;
    const show = () => {
      setSaying((s) => (s === "hello" ? s : "news"));
      setX(0);
    };
    const first = setTimeout(show, saying === "hello" ? HELLO_MS + 800 : 1200);
    const every = setInterval(show, NEWS_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNews, nudge?.id, other?.id]);
  useEffect(() => {
    if (saying !== "news") return;
    const t = setTimeout(() => setSaying(null), SAY_MS);
    return () => clearTimeout(t);
  }, [saying]);

  // Out and about while there's nothing to say (and nobody is holding it).
  const held = drag !== null || landing;
  useEffect(() => {
    if (saying || reduced || held) return;
    let timer: ReturnType<typeof setTimeout>;
    const go = () => {
      const a = nextAct(xRef.current);
      setAct(a);
      setStep((n) => n + 1);
      if (a.x !== undefined) {
        setFacingLeft(a.x < xRef.current);
        setX(a.x);
      }
      timer = setTimeout(go, a.rest ? 5000 : 2600 + Math.random() * 2400);
    };
    timer = setTimeout(go, 900);
    return () => clearTimeout(timer);
  }, [saying, reduced, held]);

  const talking = saying === "hello" || (saying === "news" && hasNews);
  // The bubble waits until the buddy has walked over to the left.
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    if (!talking) return setArrived(false);
    const t = setTimeout(() => setArrived(true), xRef.current < 0.05 ? 50 : 750);
    return () => clearTimeout(t);
  }, [talking, buddy.id]);
  // Held or flying through the air: surprised. Bouncing along the ground: happy.
  const mood: BuddyMood = drag ? (drag.air === false ? "happy" : "surprised") : talking ? "happy" : act.mood;
  const motion: BuddyMotion = drag ? "none" : talking ? "none" : act.motion;
  const newsBuddy = nudge ? buddy : other;

  return (
    <section ref={stage} className="relative h-36" aria-label={`${buddy.name}, your study buddy`}>
      <Hills />
      <h1 className="sr-only">
        {voice.hello}, {childName}
      </h1>
      {/* The buddy, wandering along the top. Its left edge moves between 0 and the full width minus its own. */}
      <div
        ref={body}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          "absolute top-4 cursor-grab touch-none select-none",
          drag ? "z-10 cursor-grabbing transition-none" : landing ? "transition-none" : "transition-[left] ease-in-out",
          !drag && !landing && (talking ? "duration-700" : "duration-[2200ms]"),
        )}
        style={drag ? { left: drag.left, top: drag.top, transform: `rotate(${drag.tilt}deg) scale(${drag.air === undefined ? 1.08 : 1})` } : { left: `calc(${x} * (100% - ${BUDDY_PX}px))` }}
      >
        <div className="relative">
          <button
            // Taps arrive through the pointer handlers above; this is for the keyboard (Enter or Space).
            onClick={(e) => e.detail === 0 && onTap()}
            className="relative block rounded-3xl p-1 transition-transform active:scale-95"
            aria-label={`Switch buddy (talking to ${buddy.name}). You can drag ${buddy.name} around too.`}
          >
            <span key={buddy.id} className="block animate-pop">
              <span className={cn("block transition-transform duration-300", facingLeft && !talking && "-scale-x-100", act.rest && !talking && "scale-y-90")} style={{ transformOrigin: "50% 100%" }}>
                <BuddyFace key={step} color={buddy.color} wear={buddy.wear} mood={mood} motion={reduced ? "none" : motion} className="size-24" title={buddy.name} star={buddy.main} />
              </span>
            </span>
          </button>
          {/* Its shadow on the grass (it shrinks when the buddy is lifted). */}
          <span className={cn("pointer-events-none absolute -bottom-1 left-1/2 h-2 -translate-x-1/2 rounded-full bg-ink/15 transition-all dark:bg-black/30", drag ? "w-8 opacity-50" : "w-16")} aria-hidden />
          {/* A paint button at its bottom right, to change how it looks. */}
          {!drag && <PaintButton data-no-drag name={buddy.name} onClick={onDress} className="absolute right-0 bottom-1" />}
          {/* News waiting: a bell over its head. */}
          {hasNews && !talking && !drag && (
            <button
              data-no-drag
              onClick={() => newsBuddy && onOpen(newsBuddy)}
              className="absolute -top-2 -right-1 flex size-8 animate-bounce items-center justify-center rounded-full bg-coral text-white shadow-md"
              aria-label={nudge ? `${buddy.name} has something to tell you` : `${other!.name} has something to tell you`}
            >
              <BellIcon className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* What it's saying: hello, or news with a bell. Next to the buddy, which waits at the left while it talks. */}
      {talking && arrived && !drag && (
        <div className="absolute top-6 right-0 left-[7.25rem] animate-in fade-in slide-in-from-left-2 duration-300">
          <span className="absolute top-1/2 -left-1.5 size-4 -translate-y-1/2 rotate-45 rounded-[3px] bg-buddy" aria-hidden />
          {saying === "hello" || !newsBuddy ? (
            <div className="relative rounded-3xl bg-buddy px-4 py-3 text-buddy-on">
              <p className="text-[16px] leading-snug font-semibold">{greeting}</p>
            </div>
          ) : (
            <button onClick={() => onOpen(newsBuddy)} className="group relative block w-full rounded-3xl bg-buddy px-4 py-2.5 text-left text-buddy-on active:scale-[0.98]">
              <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase opacity-90">
                <BellIcon className="size-3.5" />
                {nudge ? NUDGE_LABEL[nudge.kind] : "Psst!"}
              </span>
              <span className="mt-0.5 flex items-center gap-1">
                <span className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-snug font-semibold">
                  {nudge ? summary(nudge.text) : `${other!.name} has something to tell you!`}
                </span>
                <ChevronRightIcon className="size-5 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}
