// Everything that moves on the page: sections fading in, buddies' eyes following the pointer, buddies hopping when
// tapped and wandering the hills, the buddy maker, the chat demo and the egg.
import { BUDDY_COLORS, type BuddyColor } from "../site";

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];
const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Start a CSS animation, even if it's the same one that just ran. */
function animate(el: HTMLElement | SVGElement, value: string) {
  el.style.animation = "none";
  void (el as HTMLElement).getBoundingClientRect();
  el.style.animation = value;
}

// ---------- Sections fade up as they come into view ----------

const revealer = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("in");
      revealer.unobserve(e.target);
    }
  },
  { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
);
$$(".reveal").forEach((el) => revealer.observe(el));

// ---------- Eyes that follow the pointer ----------

const trackers = $$<SVGSVGElement>("svg.buddy[data-track]");
let frame = 0;
addEventListener(
  "pointermove",
  (e) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const svg of trackers) {
        const r = svg.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) continue;
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const pull = Math.min(1, d / 300);
        svg.style.setProperty("--lx", `${((dx / d) * 4 * pull).toFixed(2)}px`);
        svg.style.setProperty("--ly", `${((dy / d) * 3 * pull).toFixed(2)}px`);
      }
    });
  },
  { passive: true },
);

// ---------- Tap a buddy: it hops, happy ----------

function cheer(svg: SVGSVGElement, ms = 1600) {
  if (svg.dataset.cheering) return;
  const before = svg.dataset.mood ?? "idle";
  svg.dataset.cheering = "";
  svg.dataset.mood = "happy";
  svg.style.transformOrigin = "50% 90%";
  if (!reduced) animate(svg, "hop 0.8s ease-in-out 2");
  setTimeout(() => {
    svg.dataset.mood = before;
    svg.style.animation = "";
    delete svg.dataset.cheering;
  }, ms);
}
document.addEventListener("click", (e) => {
  const svg = (e.target as Element).closest<SVGSVGElement>("svg.buddy.cursor-pointer");
  if (svg) cheer(svg);
});

// ---------- Buddies on the hills: wandering, and keeping their feet on the ground ----------

/**
 * The top edge of a hill (an SVG path stretched across its field), as a height in px above the field's bottom at any
 * point across it (0 to 1). Sampled once; the svg's current height scales it, so it follows resizes.
 */
function hillTop(path: SVGPathElement) {
  const svg = path.ownerSVGElement!;
  const vb = svg.viewBox.baseVal;
  const bins = 240;
  const top: number[] = new Array(bins).fill(Infinity);
  const length = path.getTotalLength();
  for (let l = 0; l <= length; l += 2) {
    const p = path.getPointAtLength(l);
    const i = Math.round((p.x / vb.width) * (bins - 1));
    if (i >= 0 && i < bins) top[i] = Math.min(top[i], p.y);
  }
  for (let i = 0; i < bins; i++) if (!Number.isFinite(top[i])) top[i] = top[i - 1] ?? vb.height;
  return (at: number) => {
    const f = Math.min(bins - 1, Math.max(0, at * (bins - 1)));
    const i = Math.floor(f);
    const y = top[i] + (top[Math.min(bins - 1, i + 1)] - top[i]) * (f - i);
    return ((vb.height - y) / vb.height) * svg.clientHeight;
  };
}

type Walker = {
  el: HTMLElement;
  svg: SVGSVGElement;
  flip: HTMLElement;
  field: HTMLElement;
  /** Where it is across the field, 0 to 1 (its left edge, over the room it has). */
  x: number;
  home: number;
  roam: number;
  /** "away" while it's held or flying, "seated" after it's been dropped onto a cloud. */
  state: "walk" | "away" | "seated";
};

const grounds = new Map<HTMLElement, (at: number) => number>();
const walkers = new Map<HTMLElement, Walker>();
// The body ends 18 units above the bottom of the buddy's 110-unit frame; 3px lower sinks its feet into the grass.
const feet = (el: HTMLElement) => (el.offsetHeight * 18) / 110 + 3;
const room = (w: Walker) => Math.max(1, w.field.clientWidth - w.el.offsetWidth);
const groundUnder = (w: Walker) => grounds.get(w.field)!((w.el.offsetLeft + w.el.offsetWidth / 2) / w.field.clientWidth) - feet(w.el);

function place(w: Walker) {
  w.el.style.left = `${w.x * room(w)}px`;
}

/** Make a buddy one of a hill's wanderers. */
function walkOn(el: HTMLElement, field: HTMLElement, x: number) {
  const w: Walker = walkers.get(el) ?? {
    el,
    svg: el.querySelector<SVGSVGElement>("svg.buddy")!,
    flip: el.querySelector<HTMLElement>(".flip")!,
    field,
    x,
    home: x,
    roam: 0.12,
    state: "walk",
  };
  Object.assign(w, { field, x, home: x, state: "walk" });
  w.svg.style.transformOrigin = "50% 90%";
  if (!walkers.has(el)) {
    walkers.set(el, w);
    if (!reduced) setTimeout(() => wander(w), 600 + Math.random() * 2000);
  }
  el.style.transition = "none";
  place(w);
  return w;
}

for (const field of $$("[data-wander]")) {
  const path = document.getElementById(field.dataset.hill ?? "") as SVGPathElement | null;
  grounds.set(field, path ? hillTop(path) : () => 0);
  const crowd = $$("[data-x]", field);
  for (const el of crowd) {
    const w = walkOn(el, field, Number(el.dataset.x));
    // A crowd stays spread out: each buddy roams its own stretch of hill. A lone one roams all of it.
    w.roam = crowd.length > 3 ? 0.18 : 0.5;
  }
}

function wander(w: Walker) {
  setTimeout(() => wander(w), 2600 + Math.random() * 2600);
  if (w.state !== "walk" || w.svg.dataset.cheering) return;
  const r = Math.random();
  if (r < 0.5) {
    let to = w.home + (Math.random() * 2 - 1) * w.roam;
    if (Math.abs(to - w.x) < w.roam / 3) to = to > w.home ? to - w.roam : to + w.roam;
    to = Math.min(0.98, Math.max(0.02, to));
    w.flip.style.transform = to < w.x ? "scaleX(-1)" : "";
    w.x = to;
    w.el.style.transition = "left 2.2s ease-in-out";
    place(w);
    animate(w.svg, "hop 0.8s ease-in-out 3");
    w.svg.dataset.mood = "idle";
  } else if (r < 0.65) {
    w.svg.style.animation = "";
    w.svg.dataset.mood = "look";
  } else if (r < 0.8) {
    animate(w.svg, "wiggle 0.7s ease-in-out 2");
    w.svg.dataset.mood = "wink";
  } else if (r < 0.9) {
    w.svg.style.animation = "";
    w.svg.dataset.mood = "thinking";
  } else {
    animate(w.svg, "hop 0.8s ease-in-out 1");
    w.svg.dataset.mood = "happy";
  }
}

// Every frame, walking buddies (mid-stride too) stand on the hill right under them.
const visible = new Set<Element>();
const fieldWatch = new IntersectionObserver((entries) => entries.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target))));
grounds.forEach((_, f) => fieldWatch.observe(f));
const stand = () => {
  for (const w of walkers.values()) {
    if (w.state !== "walk" || !visible.has(w.field) || !w.el.offsetWidth) continue;
    w.el.style.bottom = `${groundUnder(w)}px`;
  }
  requestAnimationFrame(stand);
};
requestAnimationFrame(stand);
addEventListener("resize", () => walkers.forEach((w) => w.state === "walk" && ((w.el.style.transition = "none"), place(w))));

// The hero's hill buddies arrive one at a time, in a random order, over three seconds. (A script animation rather than
// CSS, so picking one up, which moves it in the page, doesn't fade it in again.)
for (const el of $$("[data-arrive]")) {
  if (reduced) {
    el.removeAttribute("data-arrive");
    continue;
  }
  const fade = el.animate([{ opacity: 0, translate: "0 8px" }, { opacity: 1, translate: "0 0" }], {
    duration: 500,
    delay: Math.random() * 2500,
    easing: "ease-out",
    fill: "both",
  });
  fade.onfinish = () => {
    el.removeAttribute("data-arrive");
    fade.cancel();
  };
}

// ---------- Picking buddies up: drag any of them about, throw them, drop them on a hill or an empty cloud ----------

// While carried, a buddy lives in this layer over the page, so nothing it was inside (a bobbing cloud, a faded row)
// moves, clips or fades it.
const layer = document.createElement("div");
layer.className = "pointer-events-none fixed inset-0 z-[60]";
document.body.append(layer);

/** The classes a buddy wears sitting on a cloud, or out on a hill. */
const SEATED = "relative z-10 mx-auto -mb-[22%] w-[62%] pointer-events-auto";
const WALKING = "walker pointer-events-auto absolute bottom-0";

type Carry = {
  el: HTMLElement;
  svg: SVGSVGElement;
  flip: HTMLElement;
  /** Where it came from, to put it back exactly. */
  from: { parent: Element; next: Node | null; className: string; style: string; mood: string; x: number; y: number };
};

// Little sounds made with the Web Audio API (as in the app's sounds.ts): a yelp when a buddy is picked up, a boing for
// each bounce and a soft poof on a cloud. Browsers only allow audio after a tap or click; picking a buddy up is one.
let audio: AudioContext | null = null;
function sound(): AudioContext | null {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    return audio;
  } catch {
    return null;
  }
}
/** A note gliding through `freqs` over `dur` seconds, with a quick attack and a soft fade. */
function tone(freqs: number[], dur: number, type: OscillatorType, gain: number) {
  const a = sound();
  if (!a) return;
  const t = a.currentTime;
  const osc = a.createOscillator();
  const env = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqs[0], t);
  freqs.slice(1).forEach((f, i) => osc.frequency.exponentialRampToValueAtTime(f, t + (dur * (i + 1)) / (freqs.length - 1)));
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
/** Eek! A little squeak up and back down, a bit different every time. */
const pickUpSound = () => {
  const f = 650 + Math.random() * 200;
  tone([f, f * 2.1, f * 1.4], 0.22, "triangle", 0.12);
};
/** Boing, softer for smaller bounces. `speed` is how fast it hit the ground (px per ms). */
const bounceSound = (speed: number) => tone([260, 120], 0.22, "triangle", Math.min(0.2, 0.05 + speed * 0.12));
/** Poof: a soft burst of muffled noise, like landing in something fluffy. */
const cloudSound = () => {
  const a = sound();
  if (!a) return;
  const t = a.currentTime;
  const dur = 0.35;
  const noise = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = noise;
  const filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1400, t);
  filter.frequency.exponentialRampToValueAtTime(300, t + dur);
  const env = a.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(env).connect(a.destination);
  src.start(t);
};

// Body bottom as a share of the buddy's height (y 74 in its -18..92 frame).
const BODY_BOTTOM = 92 / 110;

for (const el of $$("[data-carry]")) {
  el.style.touchAction = "none";
  el.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    let carry: Carry | null = null;
    let dx = 0;
    let dy = 0;
    const trail: { t: number; x: number; y: number }[] = [];
    const move = (e: PointerEvent) => {
      // A small wobble is still a tap.
      if (!carry && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 6) return;
      if (!carry) {
        const r = el.getBoundingClientRect();
        dx = down.clientX - r.left;
        dy = down.clientY - r.top;
        carry = lift(el);
        pickUpSound();
      }
      const now = performance.now();
      trail.push({ t: now, x: e.clientX, y: e.clientY });
      while (trail.length > 1 && now - trail[0].t > 100) trail.shift();
      el.style.left = `${e.clientX - dx}px`;
      el.style.top = `${e.clientY - dy}px`;
      carry.flip.style.transform = `rotate(${Math.max(-16, Math.min(16, e.movementX * 2))}deg) scale(1.1)`;
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      if (!carry) return;
      // Dragged, not tapped: swallow the click that follows so it doesn't also hop.
      addEventListener("click", (e) => e.stopPropagation(), { capture: true, once: true });
      const [first, last] = [trail[0], trail.at(-1)];
      const span = first && last ? last.t - first.t : 0;
      const cap = (v: number) => Math.max(-2.4, Math.min(2.4, v));
      fly(carry, span > 0 ? cap((last!.x - first!.x) / span) : 0, span > 0 ? cap((last!.y - first!.y) / span) : 0);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
  });
}

function lift(el: HTMLElement): Carry {
  const r = el.getBoundingClientRect();
  const svg = el.querySelector<SVGSVGElement>("svg.buddy")!;
  const carry: Carry = {
    el,
    svg,
    flip: el.querySelector<HTMLElement>(".flip")!,
    from: { parent: el.parentElement!, next: el.nextSibling, className: el.className, style: el.getAttribute("style") ?? "", mood: svg.dataset.mood ?? "idle", x: r.left + scrollX, y: r.top + scrollY },
  };
  const w = walkers.get(el);
  if (w) w.state = "away";
  el.dataset.away = "";
  layer.append(el);
  el.className = "carried pointer-events-auto absolute";
  el.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;margin:0;touch-action:none`;
  svg.style.animation = "";
  svg.dataset.mood = "surprised";
  return carry;
}

/** The hills a thrown buddy can land on, nearest first below its feet, as a y on screen at x. */
function hillBelow(x: number, feetY: number) {
  let best: { field: HTMLElement; y: number } | null = null;
  for (const [field, ground] of grounds) {
    if (!field.hasAttribute("data-landing")) continue;
    const r = field.getBoundingClientRect();
    if (x < r.left || x > r.right) continue;
    const y = r.bottom - ground((x - r.left) / r.width) + 3;
    if (y >= feetY - 2 && (!best || y < best.y)) best = { field, y };
  }
  return best;
}

/** An empty cloud seat under x whose top the falling buddy has just reached. */
function cloudAt(x: number, before: number, after: number) {
  for (const seat of $$("[data-seat]")) {
    if (seat.querySelector("[data-carry]")) continue;
    const cloud = seat.querySelector<SVGSVGElement>("svg:not(.buddy)")!;
    const r = cloud.getBoundingClientRect();
    if (!r.width || x < r.left + r.width * 0.2 || x > r.right - r.width * 0.2) continue;
    const top = r.top + r.height * 0.3;
    if (before <= top && after >= top) return seat;
  }
  return null;
}

/** Thrown with the pointer's speed (px per ms, y down): it falls, bounces off the sides and lands somewhere. */
function fly(c: Carry, vx: number, vy: number) {
  const { el } = c;
  const gravity = 0.0028;
  let x = parseFloat(el.style.left);
  let y = parseFloat(el.style.top);
  let last = performance.now();
  const started = last;
  // Reduced motion: no flight, it's put straight back.
  if (reduced) return goHome(c);
  const frame = (now: number) => {
    const dt = Math.min(32, now - last);
    last = now;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const feetBefore = y + h * BODY_BOTTOM;
    vy += gravity * dt;
    x += vx * dt;
    y += vy * dt;
    if (x < 0 || x > innerWidth - w) {
      x = Math.max(0, Math.min(innerWidth - w, x));
      vx = -vx * 0.55;
    }
    const feetY = y + h * BODY_BOTTOM;
    const mid = x + w / 2;
    // Falling onto an empty cloud: it sits down there.
    const seat = vy > 0 ? cloudAt(mid, feetBefore, feetY) : null;
    if (seat) {
      cloudSound();
      return sit(c, seat);
    }
    const hill = hillBelow(mid, feetBefore);
    let grounded = false;
    if (hill && feetY >= hill.y) {
      y = hill.y - h * BODY_BOTTOM;
      grounded = true;
      if (vy > 0.12) bounceSound(vy);
      vy = Math.abs(vy) > 0.15 ? -vy * 0.45 : 0;
      vx *= vy === 0 ? 0.88 : 0.82;
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    c.svg.dataset.mood = grounded ? "happy" : "surprised";
    c.flip.style.transform = `${vx < 0 ? "scaleX(-1) " : ""}rotate(${Math.max(-20, Math.min(20, Math.abs(vx) * 25))}deg)`;
    // Nowhere to land (off the bottom of the screen), or taking too long: back where it came from.
    if ((!hill && y > innerHeight) || now - started > 6000) return goHome(c);
    if (grounded && vy === 0 && Math.abs(vx) < 0.02) return land(c, hill!.field, mid);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Done: happy, upright, a little hop. */
function settle(c: Carry) {
  delete c.el.dataset.away;
  c.flip.style.transform = "";
  c.svg.dataset.mood = "happy";
  animate(c.svg, "hop 0.8s ease-in-out 1");
}

/** Landed on a hill: it joins that hill's wanderers, right where it came down. */
function land(c: Carry, field: HTMLElement, mid: number) {
  const r = field.getBoundingClientRect();
  c.el.className = WALKING;
  c.el.style.cssText = `width:${c.el.offsetWidth}px;touch-action:none`;
  field.append(c.el);
  const w = walkOn(c.el, field, 0);
  w.x = w.home = Math.min(1, Math.max(0, (mid - r.left - c.el.offsetWidth / 2) / room(w)));
  place(w);
  settle(c);
}

/** Dropped onto an empty cloud: it sits there and rides along. */
function sit(c: Carry, seat: HTMLElement) {
  const w = walkers.get(c.el);
  if (w) w.state = "seated";
  c.el.className = SEATED;
  c.el.style.cssText = "touch-action:none";
  seat.prepend(c.el);
  settle(c);
}

/** Float back to where it was picked up from, and slot back in. */
function goHome(c: Carry) {
  const { el, from } = c;
  el.style.transition = "left .7s cubic-bezier(.3,.7,.3,1), top .7s cubic-bezier(.3,.7,.3,1)";
  el.style.left = `${from.x - scrollX}px`;
  el.style.top = `${from.y - scrollY}px`;
  c.svg.dataset.mood = "happy";
  c.flip.style.transform = "";
  setTimeout(() => {
    from.parent.insertBefore(el, from.next && from.next.parentNode === from.parent ? from.next : null);
    el.className = from.className;
    el.setAttribute("style", from.style);
    c.svg.dataset.mood = from.mood;
    const w = walkers.get(el);
    if (w) w.state = from.parent.hasAttribute("data-seat") ? "seated" : "walk";
    delete el.dataset.away;
  }, reduced ? 0 : 720);
}

// ---------- A buddy for everything: tap one and it steps up beside the phone to answer ----------

type CastCard = { kind: "painting" | "quiz"; title: string; done: string };
type CastBuddy = { id: string; name: string; role: string; main: string; on: string; chats: { q: string; a: string; card?: CastCard }[] };
// What the buddy is up to, under its painting or quiz, as in the app.
const PAINTING_LINES = ["Mixing the colours…", "Sketching it out…", "Painting the big shapes…", "Adding the details…", "A little sparkle…"];
const QUIZ_LINES = ["Thinking up questions…", "Writing them down…", "Checking the answers…"];
const castField = document.querySelector<HTMLElement>("[data-cast]");
if (castField) {
  const field = castField;
  const cast: CastBuddy[] = JSON.parse(field.dataset.cast!);
  const chat = field.querySelector<HTMLElement>("[data-cast-chat]")!;
  const switcher = field.querySelector<HTMLButtonElement>("[data-cast-switch]")!;
  const menu = field.querySelector<HTMLElement>("[data-cast-menu]")!;
  const send = field.querySelector<HTMLElement>("[data-cast-send]")!;
  let current = cast[0];
  // Which question each buddy answers next.
  const next = new Map<string, number>();
  // Bumped on every pick or question, so anything still playing out for an old one stops.
  let turn = 0;
  // It plays by itself until someone taps a buddy.
  let auto = true;

  const add = (li: HTMLElement) => {
    if (!reduced) li.style.animation = "bubble-in .35s ease-out both";
    chat.append(li);
    // Keep the last few, like a chat that has scrolled.
    while (chat.children.length > 5) chat.firstElementChild!.remove();
    return li;
  };
  const bubble = (who: "kid" | "buddy", text: string) => {
    const li = document.createElement("li");
    li.className =
      who === "kid"
        ? "ml-auto max-w-[85%] shrink-0 rounded-3xl rounded-br-md bg-white px-3.5 py-2 text-[14px] leading-snug font-medium text-ink shadow-sm"
        : "max-w-[85%] shrink-0 rounded-3xl rounded-bl-md px-3.5 py-2 text-[14px] leading-snug font-semibold";
    if (who === "buddy") Object.assign(li.style, { background: current.main, color: current.on });
    li.textContent = text;
    return add(li);
  };
  const card = (kind: string, title: string) => {
    const li = (field.querySelector<HTMLTemplateElement>(`[data-cast-card="${kind}"]`)!.content.firstElementChild!.cloneNode(true)) as HTMLElement;
    li.querySelector("[data-card-title]")!.textContent = title;
    return add(li);
  };
  /** Wait, then say whether this is still the question being answered. */
  const still = async (me: number, ms: number) => {
    await wait(reduced ? 0 : ms);
    return me === turn;
  };

  const pickBuddy = (b: CastBuddy) => {
    current = b;
    turn++;
    for (const el of $$("[data-cast-buddy]", field)) {
      const on = el.dataset.castBuddy === b.id;
      el.toggleAttribute("data-on", on);
      const svg = el.querySelector<SVGSVGElement>("svg.buddy")!;
      svg.dataset.mood = on ? "happy" : "idle";
      if (on && !reduced) animate(svg, "hop 0.8s ease-in-out 2");
    }
    for (const el of $$("[data-cast-face]", field)) el.classList.toggle("hidden", el.dataset.castFace !== b.id);
    field.querySelector("[data-cast-name]")!.textContent = b.name;
    field.querySelector("[data-cast-role]")!.textContent = b.role;
    field.querySelector("[data-cast-placeholder]")!.textContent = `Message ${b.name}…`;
    send.style.background = b.main;
    chat.replaceChildren();
  };

  /** The kid asks the current buddy its next question, and the buddy answers: in words, or with a painting or a quiz. */
  const ask = async () => {
    const me = ++turn;
    const b = current;
    const i = next.get(b.id) ?? 0;
    next.set(b.id, (i + 1) % b.chats.length);
    const { q, a, card: make } = b.chats[i];
    bubble("kid", q);
    const typing = bubble("buddy", "");
    typing.className = "flex w-14 shrink-0 items-center justify-center gap-1 rounded-3xl rounded-bl-md px-3 py-2.5";
    typing.innerHTML = [0, 1, 2].map((d) => `<span class="size-1.5 rounded-full bg-current" style="animation:typing 1s ease-in-out infinite;animation-delay:${d * 0.15}s"></span>`).join("");
    const answered = await still(me, 1000);
    typing.remove();
    if (!answered) return;
    bubble("buddy", a);
    if (!make || !(await still(me, 600))) return;

    if (make.kind === "painting") {
      const li = card("painting", `${b.name} is painting "${make.title}"`);
      const line = li.querySelector("[data-card-line]")!;
      for (const text of PAINTING_LINES) {
        line.textContent = text;
        if (!(await still(me, 1300))) return;
      }
    } else {
      const li = card("quiz", `${b.name} is making your quiz`);
      const line = li.querySelector("[data-card-line]")!;
      const cards = $$("[data-quiz-card]", li);
      const dots = $$("[data-quiz-dot]", li);
      const pencil = li.querySelector<HTMLElement>("[data-quiz-pencil]")!;
      // Each question card is written, then dealt onto the pile; the ones under it tilt this way and that.
      for (let n = 0; n < cards.length; n++) {
        line.textContent = QUIZ_LINES[n % QUIZ_LINES.length];
        cards.forEach((c, k) => {
          c.classList.toggle("hidden", k > n || k < n - 2);
          c.style.zIndex = String(k);
          c.style.rotate = k === n ? "" : k === n - 1 ? "3deg" : "-6deg";
          c.style.opacity = k === n ? "" : "0.9";
        });
        cards[n].classList.add("quiz-deal");
        dots.forEach((d, k) => (d.style.opacity = k <= n ? "1" : ""));
        pencil.classList.remove("hidden");
        animate(pencil, reduced ? "none" : "quiz-pencil 2.2s ease-in-out both");
        if (!(await still(me, 2200))) return;
      }
      li.replaceWith(card("quiz-ready", make.title));
    }
    if (await still(me, 400)) bubble("buddy", make.done);
  };

  const openMenu = (open: boolean) => {
    menu.classList.toggle("hidden", !open);
    switcher.setAttribute("aria-expanded", String(open));
  };
  /** Someone tapped a buddy: a new one steps up and answers, the one already there answers its next question. */
  const choose = (id: string) => {
    auto = false;
    openMenu(false);
    const b = cast.find((c) => c.id === id)!;
    if (b !== current) pickBuddy(b);
    void ask();
  };
  switcher.addEventListener("click", (e) => {
    e.stopPropagation();
    openMenu(menu.classList.contains("hidden"));
  });
  document.addEventListener("click", () => openMenu(false));
  document.addEventListener("keydown", (e) => e.key === "Escape" && openMenu(false));
  for (const el of $$("[data-cast-pick]", field)) el.addEventListener("click", () => choose(el.dataset.castPick!));
  for (const el of $$("[data-cast-buddy]", field)) el.addEventListener("click", () => choose(el.dataset.castBuddy!));

  pickBuddy(current);
  if (reduced) void ask();
  else {
    // Once it's in view: each buddy in turn steps up and answers, until someone joins in.
    new IntersectionObserver(
      async ([e], o) => {
        if (!e.isIntersecting) return;
        o.disconnect();
        for (let i = 0; auto; i++) {
          if (i > 0) pickBuddy(cast[i % cast.length]);
          await wait(900);
          if (!auto) break;
          await ask();
          await wait(3800);
        }
      },
      { threshold: 0.4 },
    ).observe(field);
  }
}

// ---------- The chat demo plays when it comes into view ----------

const chat = document.querySelector<HTMLElement>("[data-demo-chat]");
if (chat && !reduced) {
  const lines = $$("[data-line]", chat);
  const typing = chat.querySelector<HTMLElement>("[data-typing]")!;
  const hide = () => lines.forEach((l) => (l.style.display = "none"));
  const show = (el: HTMLElement) => {
    el.style.display = "";
    el.style.animation = "bubble-in .35s ease-out both";
  };
  hide();
  let playing = false;
  const play = async () => {
    if (playing) return;
    playing = true;
    for (;;) {
      hide();
      await wait(500);
      for (const line of lines) {
        if (line.dataset.who === "buddy") {
          typing.style.display = "flex";
          chat.append(typing);
          await wait(1300);
          typing.style.display = "none";
        } else {
          await wait(line.dataset.who === "kid" ? 900 : 500);
        }
        show(line);
        await wait(700);
      }
      await wait(6000);
    }
  };
  new IntersectionObserver(([e], o) => {
    if (e.isIntersecting) {
      play();
      o.disconnect();
    }
  }, { threshold: 0.4 }).observe(chat);
}

// ---------- Hatch the egg ----------

const egg = document.querySelector<HTMLElement>("[data-egg]");
if (egg) {
  const shell = egg.querySelector<SVGSVGElement>("[data-egg-shell]")!;
  const top = egg.querySelector<SVGGElement>('[data-egg-half="top"]')!;
  const bottom = egg.querySelector<SVGGElement>('[data-egg-half="bottom"]')!;
  const crackLine = egg.querySelector<SVGPolylineElement>("[data-egg-crack]")!;
  const hatchling = egg.querySelector<HTMLElement>("[data-egg-buddy]")!;
  const hatchSvg = hatchling.querySelector<SVGSVGElement>("svg")!;
  const confetti = egg.querySelector<HTMLElement>("[data-egg-confetti]")!;
  const caption = document.querySelector<HTMLElement>("[data-egg-caption]")!;
  const button = egg.querySelector<HTMLButtonElement>("[data-egg-button]")!;
  const GREETINGS = ["Hi! I'm your new buddy!", "Hello! Shall we learn something?", "Ta-da! Nice to meet you!", "Hiya! What are we working on?"];
  let state: "egg" | "hatching" | "hatched" = "egg";

  const reset = () => {
    for (const el of [shell, top, bottom, crackLine, hatchling] as (HTMLElement | SVGElement)[]) el.style.animation = "";
    crackLine.style.strokeDashoffset = "1";
    crackLine.style.opacity = "";
    hatchling.style.opacity = "0";
    shell.style.opacity = "1";
    caption.textContent = "";
    button.setAttribute("aria-label", "Hatch a buddy");
    state = "egg";
  };

  button.addEventListener("click", async () => {
    if (state === "hatching") return;
    if (state === "hatched") return reset();
    state = "hatching";
    const color = pick(Object.keys(BUDDY_COLORS).filter((c) => c !== "navy") as BuddyColor[]);
    hatchSvg.style.setProperty("--b", BUDDY_COLORS[color].main);
    hatchSvg.style.setProperty("--bi", BUDDY_COLORS[color].ink);

    if (!reduced) {
      shell.style.animation = "egg-wobble .85s ease-in-out 2";
      await wait(900);
      crackLine.style.animation = "crack .45s ease-out both";
      await wait(800);
      top.style.animation = "shell-fly .8s cubic-bezier(.3,.7,.4,1) both";
      bottom.style.animation = "shell-drop .8s ease-in both";
      crackLine.style.opacity = "0";
      await wait(150);
    } else {
      shell.style.opacity = "0";
    }
    hatchling.style.opacity = "1";
    hatchling.style.animation = reduced ? "" : "hatch-pop .7s cubic-bezier(.2,1.4,.4,1) both";
    if (!reduced) burst();
    caption.textContent = `${pick(GREETINGS)} (tap to hatch another)`;
    button.setAttribute("aria-label", "Hatch another buddy");
    await wait(700);
    state = "hatched";
  });

  function burst() {
    const colors = Object.values(BUDDY_COLORS).map((c) => c.main);
    for (let i = 0; i < 26; i++) {
      const bit = document.createElement("span");
      const angle = (i / 26) * Math.PI * 2;
      const dist = 70 + Math.random() * 70;
      bit.style.cssText = `position:absolute;left:0;top:0;width:${6 + Math.random() * 6}px;height:${8 + Math.random() * 6}px;border-radius:2px;background:${pick(colors)};--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist}px;animation:confetti 1.2s cubic-bezier(.1,.7,.3,1) both`;
      confetti.append(bit);
      setTimeout(() => bit.remove(), 1300);
    }
  }
}
