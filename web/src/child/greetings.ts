// How a buddy says hello on the home screen, and what it says after. Each buddy gets its own voice, picked from what
// the child wrote about it (a pirate says "Ahoy"), its subject, and otherwise a personality that stays the same for
// that buddy. Everything here is written ahead of time: no AI involved.

import type { Buddy } from "../../../src/shared/protocol";

interface Voice {
  /** Goes before the child's name in the big greeting, e.g. "Ahoy" -> "Ahoy, Sam". */
  hello: string;
  lines: string[];
}

const THEMES: (Voice & { match: RegExp })[] = [
  { match: /pirate|ship|sail|treasure|parrot/i, hello: "Ahoy", lines: ["What be we working on today?", "Let's hunt for treasure… I mean answers!", "No problem's too tricky for this crew.", "Steady as she goes, one step at a time."] },
  { match: /space|astronaut|rocket|planet|alien|galaxy/i, hello: "Hello, space cadet", lines: ["Ready for launch?", "Houston, we have homework!", "Let's explore this one together.", "One small step at a time."] },
  { match: /owl|wise|wizard|magic|spell/i, hello: "Greetings", lines: ["Hoo's ready to learn? You are!", "No magic answers, but lots of clever hints.", "A wise buddy always asks: where are you stuck?", "Let's think it through together."] },
  { match: /robot|computer|android|machine/i, hello: "Beep boop", lines: ["Loading… ready to help!", "Input your question, human friend.", "Processing… you've got this.", "Fun fact: robots love a good puzzle."] },
  { match: /dragon|dinosaur|dino|monster/i, hello: "Rawr", lines: ["Let's stomp through this homework.", "Big problems? We'll munch them up bit by bit.", "Mighty work today!", "Ready to roar through it?"] },
  { match: /coach|sport|football|cheer|champion/i, hello: "Let's go", lines: ["Warm-up time! What are we working on?", "You've got this, champ!", "One rep at a time.", "Big effort today. Let's do it!"] },
  { match: /cat|kitten|dog|puppy/i, hello: "Hiya", lines: ["*happy wiggle* What are we doing today?", "Ooh, what are we sniffing out?", "Let's pounce on this one together.", "Good work deserves a treat!"] },
  { match: /teacher|professor|tutor|scientist/i, hello: "Good to see you", lines: ["What are we learning today?", "Every question is a good question.", "Show me what you've tried so far.", "Let's work it out step by step."] },
  { match: /calm|chill|relax|gentle/i, hello: "Hello", lines: ["Take a breath. We'll do this together.", "No rush. What are we working on?", "Small steps add up.", "You're doing better than you think."] },
];

const PERSONALITIES: Voice[] = [
  { hello: "Hey", lines: ["Ready when you are!", "I love a good puzzle!", "Psst… you've got this.", "Let's take it one step at a time."] },
  { hello: "Hi", lines: ["We'll do this together.", "No rush. What are we working on?", "Small steps add up.", "Stuck? Tell me where."] },
  { hello: "Ooh, hi", lines: ["What are we figuring out today?", "Hmm, I wonder what's next…", "Questions are my favourite thing.", "What have you tried so far?"] },
];

const SUBJECT_LINES: Record<string, string> = {
  maths: "Got a sum that's bugging you?",
  english: "Any reading or writing today?",
  science: "Got a science question? I'm curious!",
  history: "Shall we travel back in time?",
  geography: "Where in the world are we today?",
  french: "Bonjour! Any French today?",
  spanish: "¡Hola! Any Spanish today?",
};

/** The buddy's greeting word and the lines it cycles through. */
export function buddyVoice(buddy: Buddy, subjectLabel: string | null): Voice {
  const voice = THEMES.find((t) => t.match.test(buddy.description)) ?? PERSONALITIES[buddy.id % PERSONALITIES.length];
  const subject = buddy.subject ? (SUBJECT_LINES[buddy.subject] ?? `Anything in ${subjectLabel ?? buddy.subject} today?`) : null;
  const [first, ...rest] = voice.lines;
  return { hello: voice.hello, lines: [first, ...(subject ? [subject] : []), "What would you like to do today?", ...rest] };
}

/** What any buddy might say when the child comes back, `{name}` being the child. */
const GREETINGS = [
  "Hi {name}! Let me know how I can help.",
  "Hey {name}! What are we working on today?",
  "Welcome back, {name}! I missed you.",
  "Oh hi {name}! Ready when you are.",
  "Hello {name}! Got any homework for me?",
  "Hey hey, {name}! What shall we do?",
  "There you are, {name}! What's up?",
  "Hi {name}! Stuck on something? I can help.",
  "Yay, it's {name}! What are we learning?",
  "Hiya {name}! Tell me what you need.",
  "Good to see you, {name}! Shall we get started?",
  "Hey {name}! I've been practising my thinking face.",
  "Hello again, {name}! Where did we get to?",
  "Hi {name}! Ask me anything about your homework.",
  "Oh, hello {name}! I was just exploring.",
  "Hey {name}! Let's make today a good one.",
  "Hi {name}! One step at a time, together.",
  "Welcome back! What can I help with, {name}?",
  "Hey {name}! I'm all ears. Well, I don't have ears, but you know what I mean.",
  "Hi {name}! Fancy a puzzle, a picture or some homework?",
];

let lastGreeting = "";

/**
 * What the buddy says when the child arrives or switches to it: one of the greetings above, its own themed hello, or
 * a line about its subject, picked at random (never the same as last time).
 */
export function buddyGreeting(buddy: Buddy, subjectLabel: string | null, name: string): string {
  const voice = buddyVoice(buddy, subjectLabel);
  const own = [`${voice.hello}, ${name}!`, ...(buddy.subject ? [`Hi ${name}! ${voice.lines[1]}`] : [])];
  const pool = [...GREETINGS.map((g) => g.replaceAll("{name}", name)), ...own, ...own].filter((g) => g !== lastGreeting);
  lastGreeting = pool[Math.floor(Math.random() * pool.length)];
  return lastGreeting;
}
