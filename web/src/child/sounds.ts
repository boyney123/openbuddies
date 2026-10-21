// Little sound effects, made with the Web Audio API (no sound files). Browsers only allow audio after the child has
// tapped something, so call unlockAudio() from the tap that leads to a sound.

const MUTE_KEY = "openbuddies.soundOff";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a tap, so sounds played just after are allowed. */
export function unlockAudio() {
  audio();
}

export function soundOn(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) !== "1";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    if (on) localStorage.removeItem(MUTE_KEY);
    else localStorage.setItem(MUTE_KEY, "1");
  } catch {}
}

/** One note: a quick attack, then a soft fade. `to` slides the pitch. */
function tone(at: number, freq: number, dur: number, { type = "sine", to, gain = 0.2 }: { type?: OscillatorType; to?: number; gain?: number } = {}) {
  const a = audio();
  if (!a || !soundOn()) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const env = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** A short burst of filtered noise, for cracks. */
function crackle(at: number, dur: number, freq: number, gain = 0.25) {
  const a = audio();
  if (!a || !soundOn()) return;
  const t = a.currentTime + at;
  const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 1.2;
  const env = a.createGain();
  env.gain.value = gain;
  src.connect(filter).connect(env).connect(a.destination);
  src.start(t);
}

/** The egg rocking: soft wooden taps, one per swing. */
export function wobbleTaps(swings: number[]) {
  swings.forEach((s, i) => tone(s, i % 2 ? 520 : 600, 0.09, { type: "triangle", to: 380, gain: 0.12 }));
}

/** The shell cracking: a few crisp snaps. */
export function crack() {
  crackle(0, 0.08, 2600);
  crackle(0.11, 0.06, 3200, 0.2);
  crackle(0.2, 0.12, 2200, 0.3);
}

/** The buddy popping out: a rising bloop, then a sparkly chime. */
export function hatch() {
  tone(0, 260, 0.18, { to: 820, gain: 0.25 });
  tone(0.05, 390, 0.16, { type: "triangle", to: 1100, gain: 0.08 });
  [1047, 1319, 1568, 2093].forEach((f, i) => tone(0.22 + i * 0.09, f, 0.35, { type: "triangle", gain: 0.1 }));
  tone(0.6, 2637, 0.5, { gain: 0.05 });
}

/** A file flying off to the buddy: a soft rising whoosh. */
export function whoosh() {
  tone(0, 300, 0.28, { type: "sine", to: 900, gain: 0.08 });
}

/** The buddy got the file: a happy gulp and two bright notes. */
export function gotIt() {
  tone(0, 520, 0.12, { to: 260, gain: 0.18 });
  tone(0.14, 1047, 0.22, { type: "triangle", gain: 0.1 });
  tone(0.26, 1568, 0.32, { type: "triangle", gain: 0.1 });
}
