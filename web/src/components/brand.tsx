import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { ACCESSORIES, BUDDY_COLORS, isBuddyColor, type Accessory, type Buddy, type BuddyColor } from "../../../src/shared/protocol";

// The logo's speech bubble (viewBox 0 0 120 100).
const BUBBLE = "M26 24H64Q78 24 78 38V60Q78 74 64 74H38L24 87L26 74Q12 74 12 60V38Q12 24 26 24Z";
// The buddy's body: the logo's speech bubble without its tail.
const BODY = "M26 24H64Q78 24 78 38V60Q78 74 64 74H26Q12 74 12 60V38Q12 24 26 24Z";

/** The OpenBuddies mark: a friendly conversation bubble in front of a coral and a blue one. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 100" className={className} role="img" aria-label="OpenBuddies">
      <path d="M38 8H72Q82 8 82 18V38H38Q28 38 28 28V18Q28 8 38 8Z" fill="#FF6B5E" />
      <path d="M60 33H98Q109 33 109 44V61Q109 72 98 72H97L101 84L88 72H60Z" fill="#2F80FF" />
      <path d={BUBBLE} fill="#fff" stroke="#102A5C" strokeWidth="7" strokeLinejoin="round" />
      <rect x="31" y="40" width="7" height="13" rx="3.5" fill="#102A5C" />
      <rect x="52" y="40" width="7" height="13" rx="3.5" fill="#102A5C" />
      <path d="M38 60Q45 67 52 60" stroke="#102A5C" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M88 13L94 4M92 20L102 15" stroke="#FF6B5E" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

/** A stack of books in the brand colours, for the Homework card. */
export function BooksArt({ className }: { className?: string }) {
  const book = (y: number, w: number, x: number, cover: string, rotate = 0) => (
    <g transform={`rotate(${rotate} ${x + w / 2} ${y + 9})`}>
      <rect x={x} y={y} width={w} height={18} rx={4} fill={cover} />
      <rect x={x + w - 14} y={y + 3} width={12} height={12} rx={2} fill="#fff" />
      <path d={`M${x + w - 12} ${y + 7}h8M${x + w - 12} ${y + 11}h8`} stroke="#DDE4F2" strokeWidth={1.5} />
      <rect x={x + 8} y={y + 6} width={w * 0.35} height={2.5} rx={1.25} fill="#fff" opacity={0.35} />
    </g>
  );
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden>
      <ellipse cx="60" cy="92" rx="46" ry="5" fill="#102A5C" opacity="0.08" />
      {book(70, 88, 14, "#102A5C")}
      {book(51, 80, 20, "#FF6B5E", -3)}
      {book(32, 76, 24, "#2F80FF", 4)}
      <path d="M92 18L97 8M99 24L109 19" stroke="#FF6B5E" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

const SPARKS = <path d="M92 18L97 8M99 24L109 19" stroke="#FF6B5E" strokeWidth="4.5" strokeLinecap="round" />;
const SHADOW = <ellipse cx="60" cy="92" rx="40" ry="5" fill="#102A5C" opacity="0.08" />;

/** A question in a speech bubble, for Ask Anything. */
export function QuestionArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden>
      {SHADOW}
      <rect x="52" y="30" width="50" height="40" rx="12" fill="#2F80FF" />
      <path d="M22 18H74Q86 18 86 30V58Q86 70 74 70H44L30 82L32 70H22Q10 70 10 58V30Q10 18 22 18Z" fill="#FF6B5E" stroke="#102A5C" strokeWidth="5" strokeLinejoin="round" />
      <path d="M38 36Q38 27 48 27Q58 27 58 35Q58 41 52 44Q48 46 48 51" stroke="#fff" strokeWidth="6.5" fill="none" strokeLinecap="round" />
      <circle cx="48" cy="60" r="4" fill="#fff" />
      {SPARKS}
    </svg>
  );
}

/** Two speech bubbles, one typing, for Chat. */
export function ChatArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden>
      {SHADOW}
      <path d="M64 30H100Q110 30 110 40V60Q110 70 100 70H96L98 80L86 70H64Q54 70 54 60V40Q54 30 64 30Z" fill="#FF6B5E" stroke="#102A5C" strokeWidth="5" strokeLinejoin="round" />
      <path d="M76 46H94M76 55H88" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M22 14H66Q78 14 78 26V50Q78 62 66 62H40L26 74L28 62H22Q10 62 10 50V26Q10 14 22 14Z" fill="#2F80FF" stroke="#102A5C" strokeWidth="5" strokeLinejoin="round" />
      {[30, 44, 58].map((cx) => (
        <circle key={cx} cx={cx} cy="38" r="4.5" fill="#fff" />
      ))}
      {SPARKS}
    </svg>
  );
}

/** A quiz card with the right answer ticked, and a gold star, for Quizzes. */
export function QuizArt({ className }: { className?: string }) {
  const option = (y: number, right: boolean, line: number) => (
    <g key={y}>
      <circle cx="36" cy={y} r="6" fill={right ? "#34C98A" : "#E3EEFF"} stroke="#102A5C" strokeWidth="3" />
      {right && <path d={`M33 ${y}L35.5 ${y + 2.5}L39.5 ${y - 2.5}`} stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      <path d={`M48 ${y}H${line}`} stroke="#C9D6EE" strokeWidth="4" strokeLinecap="round" />
    </g>
  );
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden>
      {SHADOW}
      <g transform="rotate(-6 56 50)">
        <rect x="22" y="10" width="64" height="76" rx="8" fill="#fff" stroke="#102A5C" strokeWidth="5" />
        <rect x="40" y="5" width="28" height="11" rx="4" fill="#8B5CF6" stroke="#102A5C" strokeWidth="4" />
        {option(34, false, 74)}
        {option(52, true, 70)}
        {option(70, false, 72)}
      </g>
      <path d="M95 40L98.8 48L107.5 48.9L101 54.6L102.9 63.2L95 58.8L87.1 63.2L89 54.6L82.5 48.9L91.2 48Z" fill="#FFB020" stroke="#102A5C" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M96 22L101 12M103 28L113 23" stroke="#FF6B5E" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

/** A notebook and pencil, for Revise. */
export function NotebookArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden>
      {SHADOW}
      <rect x="26" y="12" width="56" height="74" rx="8" fill="#34C98A" stroke="#102A5C" strokeWidth="5" />
      <path d="M40 32H70M40 44H70M40 56H62" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
      {[22, 38, 54, 70].map((y) => (
        <rect key={y} x="20" y={y} width="12" height="6" rx="3" fill="#102A5C" />
      ))}
      <g transform="rotate(35 88 52)">
        <rect x="82" y="22" width="13" height="50" rx="3" fill="#FFB020" stroke="#102A5C" strokeWidth="4" />
        <rect x="82" y="22" width="13" height="9" rx="3" fill="#FF6B5E" stroke="#102A5C" strokeWidth="4" />
        <path d="M82 72L88.5 84L95 72Z" fill="#F5E6C8" stroke="#102A5C" strokeWidth="4" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** A painting on an easel with a brush, for Picture Studio. */
export function EaselArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden>
      {SHADOW}
      <path d="M34 88L48 20M86 88L72 20M60 70V90" stroke="#102A5C" strokeWidth="5" strokeLinecap="round" />
      <rect x="24" y="12" width="72" height="58" rx="6" fill="#fff" stroke="#102A5C" strokeWidth="5" />
      <clipPath id="easel-canvas">
        <rect x="27" y="15" width="66" height="52" rx="3" />
      </clipPath>
      <g clipPath="url(#easel-canvas)">
        <rect x="27" y="15" width="66" height="52" fill="#E3EEFF" />
        <circle cx="76" cy="30" r="8" fill="#FFB020" />
        <path d="M20 70Q40 40 60 58Q76 44 100 64V72H20Z" fill="#34C98A" />
        <path d="M38 52L46 40L54 52Z" fill="#FF6B5E" />
      </g>
      <g transform="rotate(-38 98 58)">
        <rect x="94" y="36" width="8" height="36" rx="3" fill="#FFB020" stroke="#102A5C" strokeWidth="3.5" />
        <path d="M94 36Q98 22 102 36Z" fill="#FF6B5E" stroke="#102A5C" strokeWidth="3.5" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** A folder with a worksheet and a photo sticking out, for a buddy's files. */
export function FolderArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden>
      {SHADOW}
      {/* The back of the folder, with its tab. */}
      <path d="M16 34Q16 26 24 26H40Q44 26 47 29L52 34H96Q104 34 104 42V78Q104 86 96 86H24Q16 86 16 78Z" fill="#FF6B5E" stroke="#102A5C" strokeWidth="5" strokeLinejoin="round" />
      {/* A worksheet, ticked. */}
      <g transform="rotate(-10 46 36)">
        <rect x="27" y="10" width="38" height="48" rx="5" fill="#fff" stroke="#102A5C" strokeWidth="4.5" />
        <path d="M35 21H57M35 30H57M35 39H50" stroke="#C9D6EE" strokeWidth="4" strokeLinecap="round" />
        <path d="M34 47L38 51L45 43" stroke="#34C98A" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* A photo. */}
      <g transform="rotate(10 76 32)">
        <rect x="57" y="14" width="38" height="34" rx="5" fill="#E3EEFF" stroke="#102A5C" strokeWidth="4.5" />
        <clipPath id="folder-photo">
          <rect x="59.5" y="16.5" width="33" height="29" rx="3" />
        </clipPath>
        <g clipPath="url(#folder-photo)">
          <circle cx="83" cy="25" r="5" fill="#FFB020" />
          <path d="M55 48L69 32L79 42L85 36L97 48Z" fill="#2F80FF" />
        </g>
      </g>
      {/* The front of the folder. */}
      <path d="M12 58Q12 52 18 52H102Q109 52 108 59L104 79Q103 86 96 86H24Q17 86 16 79Z" fill="#FFB020" stroke="#102A5C" strokeWidth="5" strokeLinejoin="round" />
      <rect x="46" y="64" width="28" height="8" rx="4" fill="#fff" opacity="0.55" />
      <path d="M96 14L101 4M103 20L113 15" stroke="#FF6B5E" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

/** Rising bars and a star, for Progress. */
export function ChartArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden>
      {SHADOW}
      <rect x="22" y="56" width="18" height="28" rx="5" fill="#FF6B5E" stroke="#102A5C" strokeWidth="4.5" />
      <rect x="48" y="40" width="18" height="44" rx="5" fill="#34C98A" stroke="#102A5C" strokeWidth="4.5" />
      <rect x="74" y="24" width="18" height="60" rx="5" fill="#2F80FF" stroke="#102A5C" strokeWidth="4.5" />
      <path d="M14 86H100" stroke="#102A5C" strokeWidth="5" strokeLinecap="round" />
      <path d="M83 4L86.5 11.5L94.5 12.3L88.5 17.6L90.3 25.5L83 21.4L75.7 25.5L77.5 17.6L71.5 12.3L79.5 11.5Z" fill="#FFB020" stroke="#102A5C" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

/** A shield with a heart, for what the parent can see. */
export function ShieldArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden>
      {SHADOW}
      <path d="M60 8L94 20V46Q94 72 60 88Q26 72 26 46V20Z" fill="#2F80FF" stroke="#102A5C" strokeWidth="5" strokeLinejoin="round" />
      <path d="M60 64Q42 52 42 41Q42 33 50 33Q56 33 60 39Q64 33 70 33Q78 33 78 41Q78 52 60 64Z" fill="#fff" />
      {SPARKS}
    </svg>
  );
}

/** "Open" in navy, "Buddies" in coral. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-extrabold tracking-tight", className)}>
      <span className="text-heading">Open</span>
      <span className="text-coral">Buddies</span>
    </span>
  );
}

export type BuddyMood = "idle" | "thinking" | "happy" | "wink" | "look" | "surprised";
export type BuddyMotion = "none" | "float" | "hop" | "wiggle";

/**
 * CSS variables that colour everything buddy-tinted inside the element they're set on. The soft and strong shades
 * are derived in styles.css, so they work in light and dark mode.
 */
export function buddyVars(color: BuddyColor | undefined | null): CSSProperties {
  const c = BUDDY_COLORS[color ?? "blue"] ?? BUDDY_COLORS.blue;
  return { "--buddy": c.main, "--buddy-on": c.on } as CSSProperties;
}

const THEME_KEY = "openbuddies.buddyColor";

/** Put a buddy's theme on the whole page (see `data-buddy` in styles.css) and remember it for the next visit. */
function applyBuddyTheme(color: BuddyColor) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(buddyVars(color) as Record<string, string>)) root.style.setProperty(k, v);
  root.dataset.buddy = color;
  try {
    localStorage.setItem(THEME_KEY, color);
  } catch {}
}

/** Before the first render: the theme of the buddy last used on this device, so a reload doesn't flash. */
export function applySavedBuddyTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (isBuddyColor(saved)) applyBuddyTheme(saved);
  } catch {}
}

/**
 * Give the whole page the active buddy's theme. Switching buddy fades from one theme to the next; loading the page
 * doesn't fade (transitions are switched on only after the first theme is in place).
 */
export function useBuddyTheme(color: BuddyColor | undefined | null) {
  useEffect(() => {
    if (!color) return;
    applyBuddyTheme(color);
    const root = document.documentElement;
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => (root.dataset.themeReady = ""))));
    // The browser bar follows the tinted background once any fade has finished.
    const timer = setTimeout(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute("content", bg);
    }, 700);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [color]);
}

const N = "#102A5C";

/**
 * Things a buddy can wear, drawn in the face's 100-unit frame (the body is x 12-78, y 24-74). Hats sit on top of the
 * body and reach above the frame, so they show wherever the buddy has room above it. `dark` is a navy buddy, whose
 * glasses need a light outline to show.
 */
const ACCESSORY_ART: Record<Accessory, (dark: boolean) => React.ReactNode> = {
  cap: () => (
    <g stroke={N} strokeWidth="4" strokeLinejoin="round">
      <path d="M18 27Q20 6 45 6Q66 6 70 24Z" fill="#FF6B5E" />
      <path d="M62 22Q78 18 90 22Q90 27 84 27H62Z" fill="#E5544A" />
      <circle cx="44" cy="6" r="3" fill={N} stroke="none" />
    </g>
  ),
  beanie: () => (
    <g stroke={N} strokeLinejoin="round">
      <path d="M17 28Q17 4 45 4Q73 4 73 28Z" fill="#34C98A" strokeWidth="4" />
      <rect x="14" y="22" width="62" height="10" rx="5" fill="#22A06B" strokeWidth="4" />
      <circle cx="45" cy="2" r="6" fill="#FFF3D9" strokeWidth="3.5" />
    </g>
  ),
  crown: () => (
    <g>
      <path d="M20 28L22 8L33 18L45 4L57 18L68 8L70 28Z" fill="#FFB020" stroke={N} strokeWidth="4" strokeLinejoin="round" />
      <circle cx="45" cy="19" r="3.2" fill="#FF6B5E" />
      <circle cx="31" cy="23" r="2.4" fill="#8B5CF6" />
      <circle cx="59" cy="23" r="2.4" fill="#34C98A" />
    </g>
  ),
  party: () => (
    <g transform="rotate(12 45 16)">
      <path d="M32 26L47 -8L60 26Z" fill="#8B5CF6" stroke={N} strokeWidth="4" strokeLinejoin="round" />
      <path d="M37 15L56 17M41 5L52 7" stroke="#FFB020" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="47" cy="-9" r="4.5" fill="#FF6B5E" stroke={N} strokeWidth="3" />
    </g>
  ),
  wizard: () => (
    <g stroke={N} strokeWidth="4" strokeLinejoin="round">
      <path d="M30 22Q38 6 46 -14Q52 4 62 22Z" fill="#102A5C" />
      <ellipse cx="46" cy="24" rx="27" ry="5" fill="#2A3F7A" />
      <path d="M45 4l1.4 3 3.2.3-2.4 2.1.8 3.1-3-1.7-2.8 1.7.7-3.1-2.4-2.1 3.2-.3z" fill="#FFB020" stroke="none" />
    </g>
  ),
  headphones: () => (
    <g stroke={N} strokeWidth="4">
      <path d="M14 42Q14 8 45 8Q76 8 76 42" fill="none" strokeWidth="5" strokeLinecap="round" />
      <rect x="6" y="36" width="12" height="20" rx="5" fill="#FF6B5E" />
      <rect x="72" y="36" width="12" height="20" rx="5" fill="#FF6B5E" />
    </g>
  ),
  glasses: (dark) => (
    <g stroke={dark ? "#fff" : N} strokeWidth="3.5">
      <circle cx="34.5" cy="46" r="9" fill="rgba(255,255,255,0.25)" />
      <circle cx="55.5" cy="46" r="9" fill="rgba(255,255,255,0.25)" />
      <path d="M43.5 45Q45 43 46.5 45" fill="none" />
    </g>
  ),
  sunglasses: (dark) => (
    <g>
      <path d="M22 40H43V46Q43 54 34 54Q25 54 23 46Z M47 40H68L67 46Q65 54 56 54Q47 54 47 46Z" fill="#0B1020" stroke={dark ? "#fff" : "none"} strokeWidth="2" strokeLinejoin="round" />
      <path d="M43 42H47" stroke={dark ? "#fff" : N} strokeWidth="3" />
      <path d="M27 43H32M52 43H57" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
    </g>
  ),
  chain: () => (
    <g>
      <path d="M22 70Q45 86 68 70" fill="none" stroke="#FFB020" strokeWidth="4" strokeDasharray="3 2.5" strokeLinecap="round" />
      <circle cx="45" cy="80" r="5.5" fill="#FFB020" stroke={N} strokeWidth="3" />
    </g>
  ),
  scarf: () => (
    <g stroke={N} strokeWidth="4" strokeLinejoin="round">
      <path d="M14 64Q45 78 76 64L77 72Q45 86 13 72Z" fill="#FF6B5E" />
      <path d="M58 74L62 90L70 88L66 72Z" fill="#E5544A" />
    </g>
  ),
  bowtie: () => (
    <g stroke={N} strokeLinejoin="round">
      <path d="M45 76L32 69V83Z M45 76L58 69V83Z" fill="#8B5CF6" strokeWidth="3.5" />
      <circle cx="45" cy="76" r="3.5" fill="#6D3FE0" strokeWidth="3" />
    </g>
  ),
  medal: () => (
    <g>
      <path d="M38 66L45 78L52 66" fill="none" stroke="#2F80FF" strokeWidth="5" />
      <circle cx="45" cy="81" r="7" fill="#FFB020" stroke={N} strokeWidth="3.5" />
      <path d="M45 77.5l1.1 2.3 2.5.2-1.9 1.6.6 2.4-2.3-1.3-2.2 1.3.6-2.4-1.9-1.6 2.5-.2z" fill="#fff" />
    </g>
  ),
};

/** Glasses first, then things round the neck, then hats, so a hat sits over headphones' band and so on. */
const WEAR_ORDER = (["eyes", "neck", "head"] as const).flatMap((slot) => (Object.keys(ACCESSORIES) as Accessory[]).filter((a) => ACCESSORIES[a] === slot));

const MOTION: Record<BuddyMotion, string> = { none: "", float: "animate-float", hop: "animate-hop", wiggle: "animate-wiggle" };

/**
 * The child's tutor buddy: the brand's face on a rounded rectangle, in their chosen colour. Moods change the face (blinking,
 * looking around, winking, happy squint, thinking, surprised :O); motions move the whole buddy.
 */
export function BuddyFace({
  color = "blue",
  mood = "idle",
  motion,
  className,
  title,
  star = false,
  wear = [],
}: {
  color?: BuddyColor;
  mood?: BuddyMood;
  motion?: BuddyMotion;
  className?: string;
  title?: string;
  /** The child's main buddy wears a small gold star on its chest. */
  star?: boolean;
  /** What it's wearing, drawn over the face: glasses, then things round its neck, then a hat. */
  wear?: readonly Accessory[];
}) {
  const main = (BUDDY_COLORS[color] ?? BUDDY_COLORS.blue).main;
  const ink = color === "navy" ? "#fff" : "#102A5C";
  const move = MOTION[motion ?? (mood === "thinking" ? "float" : "none")];
  const eyeY = mood === "thinking" ? 37 : 40;
  const eyeShift = mood === "thinking" ? 3 : 0;
  // Each buddy blinks on its own timing, so a row of buddies doesn't blink in unison.
  const [blinkDelay] = useState(() => `${-(Math.random() * 4.5).toFixed(2)}s`);
  return (
    // The body (x 12-78, y 24-74) is centred in the frame; the marks at the top right draw just outside it.
    <svg viewBox="-5 7 100 84" className={cn("overflow-visible", move, className)} style={{ transformOrigin: "50% 90%" }} role="img" aria-label={title ?? "Tutor"}>
      <path d="M86 15L92 6M90 22L100 17" stroke={main} strokeWidth="4.5" strokeLinecap="round" className={cn(mood === "happy" && "animate-pulse")} />
      <path d={BODY} fill={main} stroke="#102A5C" strokeWidth="6" strokeLinejoin="round" />
      <ellipse cx="28" cy="58" rx="5" ry="3" fill="#fff" opacity={mood === "happy" || mood === "wink" ? 0.55 : 0.35} />
      <ellipse cx="62" cy="58" rx="5" ry="3" fill="#fff" opacity={mood === "happy" || mood === "wink" ? 0.55 : 0.35} />
      <g stroke={ink} strokeWidth="4.5" fill="none" strokeLinecap="round">
        {mood === "happy" && (
          <>
            <path d="M30 47Q34.5 41 39 47" />
            <path d="M51 47Q55.5 41 60 47" />
          </>
        )}
        {mood === "wink" && <path d="M51 47Q55.5 41 60 47" />}
        {(mood === "happy" || mood === "wink") && <path d="M36 57Q45 68 54 57" />}
        {mood === "thinking" && <circle cx="47" cy="61" r="3.5" fill={ink} stroke="none" />}
        {(mood === "idle" || mood === "look") && <path d="M38 59Q45 66 52 59" />}
        {/* Surprised: eyebrows up, round eyes, an "O" mouth. */}
        {mood === "surprised" && (
          <>
            <path d="M29 33Q34.5 29 40 33" />
            <path d="M50 33Q55.5 29 61 33" />
            <ellipse cx="45" cy="61" rx="4.5" ry="5.5" fill={ink} />
          </>
        )}
      </g>
      {mood === "surprised" && (
        <g fill={ink}>
          <circle cx="34.5" cy="45" r="5" />
          <circle cx="55.5" cy="45" r="5" />
          <circle cx="36" cy="43.5" r="1.6" fill="#fff" />
          <circle cx="57" cy="43.5" r="1.6" fill="#fff" />
        </g>
      )}
      {mood !== "happy" && mood !== "surprised" && (
        <g
          className={cn(mood === "idle" && "animate-blink", mood === "look" && "animate-look")}
          style={{ transformOrigin: "45px 46px", transformBox: "view-box", animationDelay: mood === "idle" ? blinkDelay : undefined }}
          fill={ink}
        >
          <rect x={31 + eyeShift} y={eyeY} width="7" height="13" rx="3.5" />
          {mood !== "wink" && <rect x={52 + eyeShift} y={eyeY} width="7" height="13" rx="3.5" />}
        </g>
      )}
      {WEAR_ORDER.filter((a) => wear.includes(a)).map((a) => (
        <Fragment key={a}>{ACCESSORY_ART[a](color === "navy")}</Fragment>
      ))}
      {/* A badge pinned on its chest. */}
      {star && <polygon points="66.0,59.5 67.4,63.1 71.2,63.3 68.3,65.7 69.2,69.4 66.0,67.4 62.8,69.4 63.7,65.7 60.8,63.3 64.6,63.1" fill="#FFB020" stroke="#102A5C" strokeWidth="1.8" strokeLinejoin="round" />}
    </svg>
  );
}

const ROUTINE: { mood: BuddyMood; motion: BuddyMotion; ms: number }[] = [
  { mood: "idle", motion: "none", ms: 2600 },
  { mood: "look", motion: "none", ms: 2400 },
  { mood: "happy", motion: "hop", ms: 1600 },
  { mood: "idle", motion: "none", ms: 2200 },
  { mood: "wink", motion: "none", ms: 1500 },
  { mood: "idle", motion: "wiggle", ms: 1400 },
  { mood: "thinking", motion: "float", ms: 2600 },
];

/**
 * Cycles the buddy through a little routine (look around, hop, wink, wiggle, think). Returns the current pose and
 * its index. Stays still when the device asks for reduced motion.
 */
export function useBuddyRoutine(): { mood: BuddyMood; motion: BuddyMotion; step: number } {
  const [step, setStep] = useState(0);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % ROUTINE.length), ROUTINE[step].ms);
    return () => clearTimeout(t);
  }, [step, reduced]);
  const pose = reduced ? ROUTINE[0] : ROUTINE[step];
  return { mood: pose.mood, motion: pose.motion, step: reduced ? 0 : step };
}

export function buddyLabel(buddy: Buddy | null | undefined): string {
  return buddy?.name ?? "Tutor";
}
