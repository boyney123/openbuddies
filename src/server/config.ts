import { existsSync, readFileSync, readdirSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join, extname, resolve } from "node:path";
import YAML from "yaml";
import { normaliseSubject, RUNGS, subjectLabel, type Rung } from "../shared/protocol.js";
import { packageRoot } from "./paths.js";
import type { ImageConfig } from "./pictures.js";

export type Mode = "strict" | "balanced" | "relaxed";
/** A subject name: lowercase words joined by hyphens, e.g. "maths", "design-technology". "other" is the fallback, never a configured subject. */
export type Subject = string;
/** Offered by `openbuddies init` and the parent page. Any valid name can be added. */
export const SUGGESTED_SUBJECTS: Subject[] = ["maths", "english", "science", "history", "geography", "french", "spanish", "computing"];

export { normaliseSubject, subjectLabel };

export interface HouseholdConfig {
  parent: { name: string; title: string; pin_hash: string };
  /** Model refs, written provider/model: "anthropic/claude-sonnet-5-5", "openrouter/google/gemini-3.5-flash". */
  models: { tutor: string; check: string };
  port: number;
  /** Extra addresses to bind besides loopback, LAN and Tailscale. Rarely needed. */
  bind: string[];
  budget: { daily_tokens_per_child: number };
  session_idle_minutes: number;
  /** App catalogues the parent added (apps.catalogues): https links to index.json files listing apps. */
  catalogues: string[];
}

export interface ChildProfile {
  id: string;
  name: string;
  age: number;
  year: string;
  subjects: Subject[];
}

export interface ChildRules {
  /** How much help to give in any subject without its own mode, including subjects the child adds for a buddy. */
  default_mode: Mode;
  /** Subjects with their own mode, overriding default_mode. */
  subjects: Record<Subject, { mode: Mode }>;
  hint_ladder: Rung[];
  max_leak_retries: number;
  alerts: { welfare: { sensitivity: "high" | "medium" | "low" } };
  /** Local times the tutor is available, e.g. "07:00-21:00". Absent means always. */
  hours?: { weekdays?: string; weekends?: string };
  /** This child's daily model-token allowance. Absent: the household's budget.daily_tokens_per_child. */
  daily_tokens?: number;
  /** Whether buddies can look things up on the internet for this child (web.ts). */
  web: WebRules;
  /** Apps turned on or off for this child, by app id. Unlisted apps follow the app's default. */
  apps: Record<string, boolean>;
  /** Picture Studio: pictures a day. */
  pictures: { daily: number };
  /** The buddies' daily check-in: on or off, and when ("HH:MM", local time). */
  heartbeat: { mode: "on" | "off"; at: string };
}

export type WebMode = "off" | "trusted" | "open";
export interface WebRules {
  /** off: never. trusted: only the trusted sites. open: any site, with SafeSearch on strict and the blocklist. */
  mode: WebMode;
  /** Sites the parent added to the trusted list, e.g. "bbc.co.uk". */
  sites: string[];
  /** Sites the parent blocked, on top of the built-in blocklist. */
  blocked: string[];
  /** Lookups a day. */
  daily_lookups: number;
}

export const DEFAULT_PICTURES_A_DAY = 6;

function parseHeartbeat(raw: any): ChildRules["heartbeat"] {
  const mode = raw?.mode ?? "on";
  if (mode !== "on" && mode !== "off") throw new Error(`rules.yaml: heartbeat.mode must be on or off, not "${mode}"`);
  const at = String(raw?.at ?? "16:30");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new Error(`rules.yaml: heartbeat.at must be a time like 16:30, not "${at}"`);
  return { mode, at };
}

/** For now every child can look things up on the wider web unless a parent turns it down. */
export const DEFAULT_WEB: WebRules = { mode: "open", sites: [], blocked: [], daily_lookups: 30 };

export interface Child {
  profile: ChildProfile;
  rules: ChildRules;
  dir: string;
}

/** The features an app can ask for. OpenBuddies provides them; an app can't add its own. */
export const APP_NEEDS = ["hint_ladder", "files", "web", "reminders", "pictures"] as const;
export type AppNeed = (typeof APP_NEEDS)[number];
/** Built-in drawings an app's home-screen card can use. */
export const APP_ARTS = ["chat", "quiz", "books", "question", "notebook", "easel", "chart", "folder", "shield"] as const;

export interface AppConfig {
  id: string;
  name: string;
  /** A Lucide icon name, from the icons OpenBuddies bundles. */
  icon: string;
  /** A built-in drawing for its card, or null to use the icon. */
  art: string | null;
  /** One line under the app's name on the child's home screen. */
  description: string;
  version: string;
  author: string;
  /** tutor: a chat with the buddy. studio: pictures drawn from the chat. quiz: the buddy's quizzes, to take. */
  kind: "tutor" | "studio" | "quiz";
  needs: AppNeed[];
  hint_ladder: boolean;
  /** On for a child unless the parent turns it off (built-in apps); installed apps start off. */
  defaultOn: boolean;
  /** builtin: comes with OpenBuddies. installed: added with `openbuddies apps add` (install.yaml). local: a folder the parent made. */
  source: "builtin" | "installed" | "local";
  /** Where an installed app came from. */
  origin: string | null;
  skill: string;
  dir: string;
}

export interface Household {
  dir: string;
  config: HouseholdConfig;
  /** The API key for each provider the models use, from .env (see apiKeyEnvName). Missing keys are left out. */
  keys: Record<string, string>;
  /** Web search credentials from .env: BRAVE_API_KEY, TAVILY_API_KEY, SEARXNG_BASE_URL, and an optional choice. */
  search: SearchConfig;
  /** Picture Studio's image models from .env: OPENAI_API_KEY, GEMINI_API_KEY, IMAGE_PROVIDER, IMAGE_MODEL. */
  images: ImageConfig;
  children: Map<string, Child>;
  apps: Map<string, AppConfig>;
  errors: string[];
}

export interface SearchConfig {
  brave?: string;
  tavily?: string;
  searxng?: string;
  /** Use only this provider. Without it, the first one set up of brave, tavily, searxng (like OpenClaw). */
  provider?: "brave" | "tavily" | "searxng";
}

export const DEFAULT_PORT = 4747;

/** A model as provider and id. The ref splits on the first "/", so OpenRouter-style ids keep theirs. */
export interface ModelRef {
  provider: string;
  id: string;
}

export function parseModelRef(ref: string): ModelRef | null {
  const i = ref.indexOf("/");
  return i > 0 && i < ref.length - 1 ? { provider: ref.slice(0, i), id: ref.slice(i + 1) } : null;
}

/** Suggested tutor and check models for the providers `openbuddies init` offers first. Any model Pi knows can be used. */
export const SUGGESTED_MODELS: Record<string, { tutor: string; check: string }> = {
  anthropic: { tutor: "anthropic/claude-sonnet-5-5", check: "anthropic/claude-haiku-5-5" },
  openai: { tutor: "openai/gpt-5.5", check: "openai/gpt-5.4-mini" },
  google: { tutor: "google/gemini-3.1-pro-preview", check: "google/gemini-3.8-flash" },
  openrouter: { tutor: "openrouter/anthropic/claude-sonnet-5.5", check: "openrouter/anthropic/claude-haiku-5.5" },
};

export const DEFAULT_MODELS = SUGGESTED_MODELS.anthropic;

/**
 * Models OpenBuddies is built and tuned for. The safety checks (welfare labels, the leak check) depend on the check
 * model, so anything else gets a warning until it has passed `pnpm eval -- --tutor <ref> --check <ref>`; add it here
 * once it has.
 */
export const RECOMMENDED_MODELS = new Set(["anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5", "openai/gpt-5.5", "openai/gpt-5.4-mini"]);

/** Providers that sign in with a chat subscription rather than an API key. Their terms don't cover a product like this. */
export const SUBSCRIPTION_PROVIDERS = new Set(["github-copilot", "openai-codex"]);

/** A warning for models OpenBuddies isn't tuned for, or null. */
export function untestedModels(models: { tutor: string; check: string }): string | null {
  const odd = [models.tutor, models.check].filter((m) => !RECOMMENDED_MODELS.has(m));
  return odd.length ? `${odd.join(" and ")} ${odd.length === 1 ? "isn't a model" : "aren't models"} OpenBuddies is tuned for. Test ${odd.length === 1 ? "it" : "them"} with the evals before your child uses it (\`pnpm eval\` in a copy of the OpenBuddies repo).` : null;
}

export const DEFAULT_RULES: ChildRules = {
  default_mode: "strict",
  subjects: {},
  hint_ladder: [...RUNGS],
  max_leak_retries: 2,
  alerts: { welfare: { sensitivity: "high" } },
  web: DEFAULT_WEB,
  apps: {},
  pictures: { daily: 6 },
  heartbeat: { mode: "on", at: "16:30" },
};

/** Where the household folder lives: --home, $OPENBUDDIES_HOME, the pointer init wrote, or ~/openbuddies. */
export function resolveHome(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.OPENBUDDIES_HOME) return resolve(process.env.OPENBUDDIES_HOME);
  const pointer = join(homedir(), ".openbuddiesrc");
  if (existsSync(pointer)) {
    const p = readFileSync(pointer, "utf8").trim();
    if (p) return p;
  }
  return join(homedir(), "openbuddies");
}

export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Where a provider's key goes in .env: ANTHROPIC_API_KEY, OPENROUTER_API_KEY… Google shares Picture Studio's GEMINI_API_KEY. */
export function apiKeyEnvName(provider: string): string {
  return provider === "google" ? "GEMINI_API_KEY" : `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

/** The providers a household's models use, tutor first. */
export function modelProviders(models: { tutor: string; check: string }): string[] {
  return [...new Set([models.tutor, models.check].map((m) => parseModelRef(m)!.provider))];
}

function readYaml(path: string): any {
  return YAML.parse(readFileSync(path, "utf8")) ?? {};
}

function modelRef(raw: unknown, role: "tutor" | "check"): string {
  if (raw === undefined) return DEFAULT_MODELS[role];
  const ref = parseModelRef(String(raw).trim());
  if (!ref) throw new Error(`openbuddies.yaml: models.${role} must be written provider/model, e.g. ${DEFAULT_MODELS[role]}`);
  if (SUBSCRIPTION_PROVIDERS.has(ref.provider)) throw new Error(`openbuddies.yaml: models.${role} uses ${ref.provider}, a chat subscription. OpenBuddies needs an API key.`);
  return `${ref.provider}/${ref.id}`;
}

export function parseHouseholdConfig(raw: any): HouseholdConfig {
  if (!raw.parent?.pin_hash) throw new Error("openbuddies.yaml: parent.pin_hash is missing. Run `openbuddies init`.");
  return {
    parent: { name: String(raw.parent?.name ?? "Parent"), title: String(raw.parent?.title ?? "Dad"), pin_hash: String(raw.parent.pin_hash) },
    models: { tutor: modelRef(raw.models?.tutor, "tutor"), check: modelRef(raw.models?.check, "check") },
    port: Number(raw.port ?? DEFAULT_PORT),
    bind: Array.isArray(raw.bind) ? raw.bind.map(String) : [],
    budget: { daily_tokens_per_child: Number(raw.budget?.daily_tokens_per_child ?? 400_000) },
    session_idle_minutes: Number(raw.session_idle_minutes ?? 30),
    catalogues: (Array.isArray(raw.apps?.catalogues) ? raw.apps.catalogues : []).map(String).filter((u: string) => /^https:\/\/\S+$/.test(u)),
  };
}

export function parseRules(raw: any): ChildRules {
  const subjects: ChildRules["subjects"] = {};
  for (const [name, v] of Object.entries<any>(raw.subjects ?? {})) {
    const mode = v?.mode;
    if (!isMode(mode)) throw new Error(`rules.yaml: subject ${name} has unknown mode "${mode}"`);
    subjects[name] = { mode };
  }
  const ladder = Array.isArray(raw.hint_ladder) ? raw.hint_ladder : DEFAULT_RULES.hint_ladder;
  for (const r of ladder) if (!RUNGS.includes(r)) throw new Error(`rules.yaml: unknown hint_ladder rung "${r}"`);
  const sensitivity = raw.alerts?.welfare?.sensitivity ?? "high";
  const defaultMode = raw.default_mode ?? "strict";
  if (!isMode(defaultMode)) throw new Error(`rules.yaml: unknown default_mode "${defaultMode}"`);
  const dailyTokens = raw.daily_tokens ?? undefined;
  if (dailyTokens !== undefined && !isAllowance(dailyTokens)) throw new Error(`rules.yaml: daily_tokens must be a whole number of tokens, at least ${MIN_ALLOWANCE}`);
  return {
    default_mode: defaultMode,
    subjects,
    hint_ladder: ladder,
    max_leak_retries: Math.max(1, Number(raw.max_leak_retries ?? DEFAULT_RULES.max_leak_retries)),
    alerts: { welfare: { sensitivity: ["high", "medium", "low"].includes(sensitivity) ? sensitivity : "high" } },
    hours: raw.hours,
    ...(dailyTokens !== undefined ? { daily_tokens: dailyTokens } : {}),
    web: parseWeb(raw.web),
    heartbeat: parseHeartbeat(raw.heartbeat),
    pictures: { daily: Number.isInteger(raw.pictures?.daily) && raw.pictures.daily >= 0 ? raw.pictures.daily : DEFAULT_PICTURES_A_DAY },
    apps: Object.fromEntries(Object.entries(raw.apps ?? {}).map(([id, v]) => [id, v === true || v === "on"])),
  };
}

const DOMAIN = /^(?=.{3,100}$)([a-z0-9-]+\.)+[a-z]{2,}$/;
/** A site as the parent typed it ("https://www.BBC.co.uk/bitesize") as a bare domain ("bbc.co.uk"), or null. */
export function cleanSite(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const host = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0].replace(/^www\./, "");
  return DOMAIN.test(host) ? host : null;
}

function parseWeb(raw: any): WebRules {
  const mode = raw?.mode ?? DEFAULT_WEB.mode;
  if (mode !== "off" && mode !== "trusted" && mode !== "open") throw new Error(`rules.yaml: web.mode must be off, trusted or open, not "${mode}"`);
  const sites = (list: unknown) => (Array.isArray(list) ? [...new Set(list.map(cleanSite).filter((s): s is string => !!s))] : []);
  const daily = raw?.daily_lookups ?? DEFAULT_WEB.daily_lookups;
  if (!Number.isInteger(daily) || daily < 0) throw new Error("rules.yaml: web.daily_lookups must be a whole number");
  return { mode, sites: sites(raw?.sites), blocked: sites(raw?.blocked), daily_lookups: daily };
}

/** The smallest daily allowance: enough for a few messages, so a typo can't silently switch a child off. */
export const MIN_ALLOWANCE = 10_000;
export const isAllowance = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= MIN_ALLOWANCE;

/** A child's daily token allowance: their own if set, else the household's. */
export function allowanceFor(household: Pick<Household, "config">, child: Pick<Child, "rules">): number {
  return child.rules.daily_tokens ?? household.config.budget.daily_tokens_per_child;
}

const isMode = (m: unknown): m is Mode => m === "strict" || m === "balanced" || m === "relaxed";

/** Mode for a subject: its own, else the child's default help level (strict unless the parent chose otherwise). */
export function modeFor(rules: ChildRules, subject: string | null | undefined): Mode {
  return (subject && rules.subjects[subject]?.mode) || rules.default_mode;
}

const APP_ALLOWED_EXT = new Set([".yaml", ".yml", ".md"]);
const APP_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const MAX_SKILL = 20_000;

/**
 * An app folder: app.yaml (what it is and what it needs) and SKILL.md (the buddy's instructions). YAML and Markdown
 * only: anything else, or an app.yaml that asks for something OpenBuddies doesn't provide, means the app is refused.
 */
export function loadApp(dir: string, id: string, source: AppConfig["source"] = "local"): AppConfig {
  if (!APP_ID.test(id)) throw new Error(`apps/${id}: an app's folder name must be 2 to 40 lowercase letters, numbers and dashes`);
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) continue;
    if (!APP_ALLOWED_EXT.has(extname(entry).toLowerCase())) {
      throw new Error(`apps/${id}: refusing to load, "${entry}" is not YAML or Markdown`);
    }
  }
  const raw = readYaml(join(dir, "app.yaml"));
  const skillPath = join(dir, "SKILL.md");
  if (!existsSync(skillPath)) throw new Error(`apps/${id}: SKILL.md is missing`);
  const skill = readFileSync(skillPath, "utf8");
  if (skill.length > MAX_SKILL) throw new Error(`apps/${id}: SKILL.md is over ${MAX_SKILL} characters`);
  const needs = Array.isArray(raw.needs) ? raw.needs.map(String) : ["hint_ladder"];
  const unknown = needs.find((n: string) => !(APP_NEEDS as readonly string[]).includes(n));
  if (unknown) throw new Error(`apps/${id}: needs "${unknown}", which OpenBuddies doesn't provide (it can use ${APP_NEEDS.join(", ")})`);
  const kind = raw.kind ?? "tutor";
  if (kind !== "tutor" && kind !== "studio" && kind !== "quiz") throw new Error(`apps/${id}: kind must be tutor, studio or quiz`);
  const art = raw.art == null ? null : String(raw.art);
  if (art !== null && !(APP_ARTS as readonly string[]).includes(art)) throw new Error(`apps/${id}: art must be one of ${APP_ARTS.join(", ")}`);
  const text = (v: unknown, fallback: string, max: number) => (v == null ? fallback : String(v)).replace(/[\p{C}<>]/gu, "").trim().slice(0, max) || fallback;
  const install = existsSync(join(dir, "install.yaml")) ? readYaml(join(dir, "install.yaml")) : null;
  const from: AppConfig["source"] = install ? "installed" : source;
  const def = raw.default ?? "on";
  return {
    id,
    name: text(raw.name, id, 30),
    icon: text(raw.icon, "sparkles", 40),
    art,
    description: text(raw.description, "", 80),
    version: text(raw.version, "1.0.0", 20),
    author: text(raw.author, "Unknown", 40),
    kind,
    needs: [...new Set(needs)] as AppNeed[],
    hint_ladder: needs.includes("hint_ladder"),
    // Someone else's app starts off for every child until the parent turns it on.
    defaultOn: from !== "installed" && def !== "off" && def !== false,
    source: from,
    origin: install?.source ? String(install.source) : null,
    skill,
    dir,
  };
}

/** Whether a child can use an app: their rules.yaml says, else the app's default. */
export function appOn(child: Pick<Child, "rules">, app: Pick<AppConfig, "id" | "defaultOn">): boolean {
  return child.rules.apps[app.id] ?? app.defaultOn;
}

export function loadChild(dir: string, id: string): Child {
  const p = readYaml(join(dir, "profile.yaml"));
  const profile: ChildProfile = {
    id,
    name: String(p.name ?? id),
    age: Number(p.age ?? 12),
    year: String(p.year ?? ""),
    subjects: [...new Set((Array.isArray(p.subjects) ? p.subjects : []).map((s: unknown) => normaliseSubject(String(s))).filter(Boolean) as Subject[])],
  };
  const rulesPath = join(dir, "rules.yaml");
  const rules = existsSync(rulesPath) ? parseRules(readYaml(rulesPath)) : DEFAULT_RULES;
  return { profile, rules, dir };
}

export function loadHousehold(dir: string): Household {
  const cfgPath = join(dir, "openbuddies.yaml");
  if (!existsSync(cfgPath)) throw new Error(`No household found at ${dir}. Run \`openbuddies init\` first.`);
  const config = parseHouseholdConfig(readYaml(cfgPath));
  const env = readEnvFile(join(dir, ".env"));
  const keys = Object.fromEntries(modelProviders(config.models).flatMap((p) => (env[apiKeyEnvName(p)] ? [[p, env[apiKeyEnvName(p)]]] : [])));
  const search: SearchConfig = {
    brave: env.BRAVE_API_KEY || undefined,
    tavily: env.TAVILY_API_KEY || undefined,
    searxng: env.SEARXNG_BASE_URL || undefined,
    provider: (["brave", "tavily", "searxng"] as const).find((p) => p === env.OPENBUDDIES_SEARCH_PROVIDER),
  };
  const errors: string[] = [];

  const children = new Map<string, Child>();
  const childrenDir = join(dir, "children");
  if (existsSync(childrenDir)) {
    for (const id of readdirSync(childrenDir)) {
      if (!statSync(join(childrenDir, id)).isDirectory()) continue;
      try {
        children.set(id, loadChild(join(childrenDir, id), id));
      } catch (e) {
        errors.push(`children/${id}: ${(e as Error).message}`);
      }
    }
  }

  // Built-in apps come with OpenBuddies; the household's apps/ holds installed apps and the parent's own. An installed
  // app may replace a built-in one; a stray folder with a built-in's name (left by an older setup) is ignored.
  const apps = new Map<string, AppConfig>();
  const load = (root: string, source: AppConfig["source"]) => {
    if (!existsSync(root)) return;
    for (const id of readdirSync(root).sort()) {
      if (!statSync(join(root, id)).isDirectory()) continue;
      try {
        const app = loadApp(join(root, id), id, source);
        if (source !== "builtin" && apps.get(id)?.source === "builtin" && app.source !== "installed") continue;
        apps.set(id, app);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  };
  load(join(packageRoot(), "apps"), "builtin");
  load(join(dir, "apps"), "local");
  const images: ImageConfig = {
    openai: env.OPENAI_API_KEY || undefined,
    google: env.GEMINI_API_KEY || undefined,
    provider: (["openai", "google"] as const).find((p) => p === env.IMAGE_PROVIDER),
    model: env.IMAGE_MODEL || undefined,
  };
  return { dir, config, keys, search, images, children, apps, errors };
}

const MODE_SENTENCE: Record<Mode, string> = {
  strict: "Strict: never give the answer, only questions, hints and worked examples of similar problems.",
  balanced: "Balanced: the answer may be shown with its working only after real effort (at least two genuine attempts).",
  relaxed: "Relaxed: explain freely, including answers, while still encouraging the child to think.",
};

/** CONTEXT.md: the child's profile and rules in plain sentences, for the tutor. */
export function renderContext(child: Child, parentTitle: string): string {
  const { profile, rules } = child;
  const lines = [
    `# About ${profile.name}`,
    "",
    `${profile.name} is ${profile.age} years old and in ${profile.year || "school"}.`,
    ...(profile.subjects.length ? [`${profile.name} studies ${profile.subjects.map(subjectLabel).join(", ")}.`] : []),
    `${profile.name} calls their parent "${parentTitle}".`,
    "",
    "## How much help to give",
    "",
  ];
  for (const s of profile.subjects) lines.push(`- ${subjectLabel(s)}: ${MODE_SENTENCE[modeFor(rules, s)]}`);
  lines.push(`- ${profile.subjects.length ? "Any other subject" : "Every subject"}: ${MODE_SENTENCE[rules.default_mode]}`);
  lines.push("", `Use words and examples that suit a ${profile.age} year old. Keep replies short.`, "");
  return lines.join("\n");
}

export function writeContextFiles(h: Household): void {
  for (const child of h.children.values()) {
    const path = join(child.dir, "CONTEXT.md");
    const next = renderContext(child, h.config.parent.title);
    if (!existsSync(path) || readFileSync(path, "utf8") !== next) writeFileSync(path, next);
  }
}

/**
 * Watch rules.yaml, profile.yaml and app files, and call onChange (debounced) when one changes.
 * CONTEXT.md and session files are written by us, so they are ignored to avoid loops.
 */
export function watchHousehold(dir: string, onChange: () => void): () => void {
  let timer: NodeJS.Timeout | undefined;
  const fire = (file: string | null) => {
    if (file && (file.includes("sessions") || file.endsWith("CONTEXT.md") || file.endsWith(".jsonl"))) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, 250);
  };
  const watchers: FSWatcher[] = [];
  for (const sub of ["children", "apps"]) {
    const p = join(dir, sub);
    if (existsSync(p)) watchers.push(watch(p, { recursive: true }, (_e, f) => fire(f ? String(f) : null)));
  }
  watchers.push(watch(join(dir, "openbuddies.yaml"), () => fire("openbuddies.yaml")));
  // A search key added by `openbuddies web setup` takes effect without a restart.
  if (existsSync(join(dir, ".env"))) watchers.push(watch(join(dir, ".env"), () => fire(".env")));
  return () => {
    clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}

/** True when `now` is inside the child's allowed hours (or no hours are set). */
export function withinHours(rules: ChildRules, now = new Date()): boolean {
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  const range = weekend ? rules.hours?.weekends : rules.hours?.weekdays;
  if (!range) return true;
  const m = range.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return true;
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= +m[1] * 60 + +m[2] && mins < +m[3] * 60 + +m[4];
}
