// The product name. Change it here and the whole site follows.
export const SITE = {
  name: "OpenBuddies",
  // The wordmark: first part in navy, second in coral (like the app).
  wordmark: ["Open", "Buddies"] as const,
  tagline: "AI for kids. You're in control.",
  description:
    "OpenBuddies is a free, open-source way to give your kids AI safely. It runs at home: kids make their own AI buddies to chat, create pictures, take quizzes and get homework help, and parents see every message and set the rules.",
  github: "https://github.com/boyney123/openbuddies",
  // Where the site is hosted. Share images need a full address, so set this before launch.
  url: "https://openbuddies.example",
  // The one-line installer (install.sh at the repo root). Once the site is live, serve install.sh from it and use that.
  install: "curl -fsSL https://raw.githubusercontent.com/boyney123/openbuddies/main/install.sh | bash",
};

// The eight buddy colours from the app (../src/shared/protocol.ts). `ink` draws the face, `on` is text on the colour.
export const BUDDY_COLORS = {
  blue: { main: "#2F80FF", ink: "#102A5C", on: "#FFFFFF" },
  coral: { main: "#FF6B5E", ink: "#102A5C", on: "#FFFFFF" },
  mint: { main: "#34C98A", ink: "#102A5C", on: "#102A5C" },
  sunny: { main: "#FFB020", ink: "#102A5C", on: "#102A5C" },
  grape: { main: "#8B5CF6", ink: "#102A5C", on: "#FFFFFF" },
  berry: { main: "#EC4899", ink: "#102A5C", on: "#FFFFFF" },
  teal: { main: "#14B8A6", ink: "#102A5C", on: "#102A5C" },
  navy: { main: "#102A5C", ink: "#FFFFFF", on: "#FFFFFF" },
} as const;
export type BuddyColor = keyof typeof BUDDY_COLORS;

export const ACCESSORIES = {
  cap: "head",
  beanie: "head",
  crown: "head",
  party: "head",
  wizard: "head",
  headphones: "head",
  glasses: "eyes",
  sunglasses: "eyes",
  chain: "neck",
  scarf: "neck",
  bowtie: "neck",
  medal: "neck",
} as const;
export type Accessory = keyof typeof ACCESSORIES;
/** Things only the website's buddies wear (not in the app's buddy maker): for grown-up buddies, like David's. */
export type Extra = "moustache" | "flatcap";
