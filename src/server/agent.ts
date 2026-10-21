// The Pi adapter. This is the only file that imports Pi, so an upstream change touches one file.
//
// Each child gets one Pi AgentSession per sitting, with exactly the six tutor tools, no built-in coding tools and no
// extensions except one first-party hook that appends the server's per-turn action to the child's message before each
// model call. That hook changes only what is sent to the model; the saved session history never contains it.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createAgentSession,
  defineTool,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  InMemoryCredentialStore,
  Type,
  type FauxResponseStep,
} from "@earendil-works/pi-ai";
import { apiKeyEnvName, modelProviders, parseModelRef, SUBSCRIPTION_PROVIDERS, type AppConfig, type Child, type Household } from "./config.js";
import type { Action } from "./decide.js";
import { fileMarker, markedFileIds, quotedTextFile, stripFileMarkers } from "./files.js";
import { actionInstruction, newFenceId, sanitiseChildText, tutorSystemPrompt } from "./prompts.js";
import type { BuddyPersona } from "./buddies.js";
import { applyToGuardProblem, effectVisibleText, guardToolCall, TOOL_SPECS, TUTOR_TOOL_NAMES, type GuardContext, type ToolEffect } from "./tools.js";

process.env.PI_TELEMETRY = "0";

export const PI_VERSION = "1.2.0";

export interface ToolCallRecord {
  tool: string;
  args: unknown;
  accepted: boolean;
  error: string | null;
}

export interface RespondInput {
  child: Child;
  app: AppConfig;
  sitting: { id: number; piSessionId: string | null };
  /** Who the child made their buddy to be, already validated. */
  persona?: BuddyPersona | null;
  text: string;
  /** The buddy the child is talking to. Shared files are loaded only from this buddy. */
  buddyId?: number | null;
  /** Files the child shared with this message. Saved in the conversation as markers; their content is loaded per call. */
  files?: { id: number; name: string }[];
  /**
   * Per-turn context: the buddy's file list and memory notes (see files.ts, memory.ts). Shown to the model after the
   * child's message and before the server's instruction, never persisted, and outside the nonce block.
   */
  material?: string;
  action: Action;
  problem: GuardContext["problem"];
  /** Stream text as it arrives. Only set when the leak check is off for this turn. */
  onDelta?: (text: string) => void;
  /** flag_for_parent fires immediately, even if the draft is later blocked. */
  onFlag?: (severity: string, summary: string) => void;
}

export interface Draft {
  text: string;
  calls: ToolCallRecord[];
  effects: ToolEffect[];
  /** Everything the child would see: reply text plus tool cards. What the leak check reads. */
  visibleText: string;
  tokens: number;
  piSessionId: string;
  /** Drop this attempt from the Pi session so a retry never sees it. */
  rollback(): Promise<void>;
}

export interface StructuredRequest {
  system: string;
  user: string;
  toolName: string;
  description: string;
  schema: Record<string, unknown>;
  model: "check" | "tutor";
  maxTokens?: number;
  /** Pictures to send with the user message (base64), e.g. a homework photo to transcribe. */
  images?: { data: string; mimeType: string }[];
}

/** Test backend: a scripted fake model, so tests and offline checks never call a real API. */
export interface FauxBackend {
  setResponses(steps: FauxResponseStep[]): void;
  appendResponses(steps: FauxResponseStep[]): void;
  pending(): number;
  /** @internal */ handle: ReturnType<typeof fauxProvider>;
}

export function createFauxBackend(): FauxBackend {
  const handle = fauxProvider({ provider: "openbuddies-faux", models: [{ id: "faux-tutor" }] });
  return {
    handle,
    setResponses: (s) => handle.setResponses(s),
    appendResponses: (s) => handle.appendResponses(s),
    pending: () => handle.getPendingResponseCount(),
  };
}
export { fauxAssistantMessage, fauxText, fauxToolCall, type FauxResponseStep };

interface TurnState {
  instruction: string;
  fenceId: string;
  childId: string;
  buddyId: number | null;
  action: Action;
  problem: GuardContext["problem"];
  calls: ToolCallRecord[];
  effects: ToolEffect[];
  onFlag?: RespondInput["onFlag"];
}

interface ChildAgent {
  session: AgentSession;
  sittingId: number;
  appId: string;
  /** The persona the session was built with; a change rebuilds it. */
  personaKey: string;
  turn: TurnState | null;
}

const redactors: string[] = [];

/** Strip any known secret from text before it is logged or shown anywhere. */
export function redact(text: string): string {
  let out = text;
  for (const s of redactors) if (s && s.length > 8) out = out.split(s).join("[redacted]");
  return out.replace(/sk-[A-Za-z0-9_\-]{12,}/g, "[redacted]");
}

function textOf(message: any): string {
  if (!message || message.role !== "assistant") return "";
  return (message.content ?? [])
    .filter((c: any) => c.type === "text" && c.text?.trim())
    .map((c: any) => c.text.trim())
    .join("\n\n");
}

function tokensOf(message: any): number {
  const u = message?.usage;
  if (!u) return 0;
  return u.totalTokens ?? (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
}

export class AgentHost {
  private agents = new Map<string, ChildAgent>();
  /** A random marker so the model can tell real server instructions from text the child typed. Stable per household. */
  private readonly nonce: string;

  private constructor(
    private household: Household,
    private runtime: ModelRuntime,
    private models: { tutor: any; check: any },
    private faux: FauxBackend | null,
  ) {
    this.nonce = householdNonce(household.dir);
  }

  private fileSource: FileSource = () => null;

  /** Where shared files come from (the server's file store), checked against the child and buddy. */
  setFileSource(source: FileSource) {
    this.fileSource = source;
  }

  /**
   * Put shared files' content next to their markers, for this model call only. The newest photos go in as images when
   * the tutor model can see them (older ones, or a text-only model, get the photo's transcription); text files go in
   * quoted. A marker for a file that's gone, or isn't this buddy's, is left as it is.
   */
  private withSharedFiles(messages: any[], childId: string, buddyId: number | null, fenceId: string): any[] {
    if (buddyId === null) return messages;
    const canSee = Array.isArray(this.models.tutor?.input) && this.models.tutor.input.includes("image");
    const photoIds = messages
      .filter((m) => m?.role === "user")
      .flatMap((m) => markedFileIds(textOfContent(m.content)))
      .filter((id) => this.fileSource(childId, buddyId, id)?.kind === "image");
    const withPixels = new Set(canSee ? photoIds.slice(-MAX_PHOTOS_IN_CONTEXT) : []);
    return messages.map((m) => {
      if (m?.role !== "user") return m;
      const ids = markedFileIds(textOfContent(m.content));
      if (!ids.length) return m;
      const extra: any[] = [];
      for (const id of ids) {
        const f = this.fileSource(childId, buddyId, id);
        if (!f) continue;
        if (f.kind === "image" && withPixels.has(id) && f.image) extra.push({ type: "image", ...f.image });
        else if (f.text) extra.push({ type: "text", text: quotedTextFile(f.name, f.text, fenceId) });
      }
      if (!extra.length) return m;
      const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : [...m.content];
      return { ...m, content: [...content, ...extra] };
    });
  }

  static async create(household: Household, opts: { faux?: FauxBackend } = {}): Promise<AgentHost> {
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
    let models: { tutor: any; check: any };
    if (opts.faux) {
      runtime.registerNativeProvider(opts.faux.handle.provider);
      await runtime.setRuntimeApiKey("openbuddies-faux", "faux");
      models = { tutor: opts.faux.handle.getModel(), check: opts.faux.handle.getModel() };
    } else {
      const refs = household.config.models;
      for (const provider of modelProviders(refs)) {
        const key = household.keys[provider];
        if (!key) throw new Error(`No ${provider} API key: add ${apiKeyEnvName(provider)} to ${join(household.dir, ".env")}`);
        redactors.push(key);
        await runtime.setRuntimeApiKey(provider, key);
      }
      models = { tutor: requireModel(runtime, refs.tutor), check: requireModel(runtime, refs.check) };
    }
    return new AgentHost(household, runtime, models, opts.faux ?? null);
  }

  /** One cheap call to prove a key works. Used by `openbuddies init`. */
  static async validateKey(modelRef: string, apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
    redactors.push(apiKey);
    try {
      const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
      await runtime.setRuntimeApiKey(parseModelRef(modelRef)?.provider ?? "", apiKey);
      const model = requireModel(runtime, modelRef);
      const msg: any = await runtime.complete(model, { messages: [{ role: "user", content: "Reply with OK.", timestamp: Date.now() }] }, { maxTokens: 16 } as any);
      if (msg.stopReason === "error") return { ok: false, error: redact(String(msg.errorMessage ?? "unknown error")) };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: redact((e as Error).message) };
    }
  }

  /** The model refs Pi knows for a provider. */
  static async knownModels(provider: string): Promise<string[]> {
    const rt = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
    return rt.getModels(provider).map((m) => `${provider}/${m.id}`);
  }

  /** Every provider Pi can reach with an API key, by name. Chat-subscription sign-ins are left out. */
  static async providers(): Promise<{ id: string; name: string }[]> {
    const rt = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
    return rt
      .getProviders()
      .filter((p) => p.auth.apiKey && !SUBSCRIPTION_PROVIDERS.has(p.id) && rt.getModels(p.id).length > 0)
      .map((p) => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Swap in a reloaded household (rules or app changed). Live sessions are rebuilt on their next turn. */
  reload(household: Household) {
    this.household = household;
    for (const a of this.agents.values()) a.session.dispose();
    this.agents.clear();
  }

  dispose() {
    for (const a of this.agents.values()) a.session.dispose();
    this.agents.clear();
  }

  private toolDefinitions(getTurn: () => TurnState | null): ToolDefinition[] {
    return TOOL_SPECS.map((spec) =>
      defineTool({
        name: spec.name,
        label: spec.name,
        description: spec.description,
        parameters: Type.Unsafe<any>(spec.parameters),
        executionMode: "sequential",
        async execute(_id, params) {
          const turn = getTurn();
          if (!turn) return { content: [{ type: "text", text: "No active turn." }], details: null, isError: true };
          const result = guardToolCall(spec.name, params, { action: turn.action, problem: turn.problem });
          turn.calls.push({ tool: spec.name, args: params, accepted: result.ok, error: result.ok ? null : result.error });
          if (!result.ok) return { content: [{ type: "text", text: `Rejected by server: ${result.error}` }], details: null, isError: true };
          turn.effects.push(result.effect);
          turn.problem = applyToGuardProblem(turn.problem, result.effect);
          if (result.effect.type === "flag") turn.onFlag?.(result.effect.severity, result.effect.summary);
          return { content: [{ type: "text", text: "Done." }], details: null };
        },
      }),
    );
  }

  private async buildSession(child: Child, app: AppConfig, sessionManager: SessionManager, getTurn: () => TurnState | null, persona: BuddyPersona | null = null): Promise<AgentSession> {
    const piDir = join(this.household.dir, "data", "pi");
    const settings = () =>
      SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 2, baseDelayMs: 1000 }, enableInstallTelemetry: false } as any);
    const contextPath = join(child.dir, "CONTEXT.md");
    const loader = new DefaultResourceLoader({
      cwd: this.household.dir,
      agentDir: piDir,
      settingsManager: settings(),
      noExtensions: true,
      disabledBuiltinExtensions: ["mcp", "codemode", "tool-search", "llama.cpp"],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: tutorSystemPrompt(app.skill, this.nonce, persona),
      agentsFilesOverride: () => ({
        agentsFiles: existsSync(contextPath) ? [{ path: contextPath, content: readFileSafe(contextPath) }] : [],
      }),
      extensionFactories: [
        {
          name: "openbuddies-turn-action",
          factory: (pi: any) => {
            pi.on("context", (event: any) => {
              const turn = getTurn();
              if (!turn) return undefined;
              const messages = this.withSharedFiles(event.messages, turn.childId, turn.buddyId, turn.fenceId);
              return { messages: appendToLastUserMessage(messages, turn.instruction) };
            });
          },
        },
      ],
    });
    await loader.reload();
    const { session } = await createAgentSession({
      cwd: this.household.dir,
      agentDir: piDir,
      modelRuntime: this.runtime,
      model: this.models.tutor,
      thinkingLevel: "off",
      tools: [...TUTOR_TOOL_NAMES],
      customTools: this.toolDefinitions(getTurn),
      resourceLoader: loader,
      sessionManager,
      settingsManager: settings(),
    });
    return session;
  }

  private async agentFor(child: Child, app: AppConfig, sitting: RespondInput["sitting"], persona: BuddyPersona | null): Promise<ChildAgent> {
    const key = child.profile.id;
    const personaKey = JSON.stringify(persona);
    const existing = this.agents.get(key);
    if (existing && existing.sittingId === sitting.id && existing.appId === app.id && existing.personaKey === personaKey) return existing;
    existing?.session.dispose();
    const sessionsDir = join(child.dir, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    const file = sitting.piSessionId ? readdirSync(sessionsDir).find((f) => f.includes(sitting.piSessionId!) && f.endsWith(".jsonl")) : undefined;
    const manager = file ? SessionManager.open(join(sessionsDir, file), sessionsDir) : SessionManager.create(this.household.dir, sessionsDir);
    const agent: ChildAgent = { session: null as any, sittingId: sitting.id, appId: app.id, personaKey, turn: null };
    agent.session = await this.buildSession(child, app, manager, () => agent.turn, persona);
    this.agents.set(key, agent);
    return agent;
  }

  /** The tools a child's session exposes to the model. Used by the startup self-test and `status --check`. */
  async sessionToolNames(child: Child, app: AppConfig): Promise<string[]> {
    const session = await this.buildSession(child, app, SessionManager.inMemory(this.household.dir), () => null);
    try {
      return [...session.getActiveToolNames()].sort();
    } finally {
      session.dispose();
    }
  }

  /** Run one tutor attempt. The caller decides whether to keep it or roll it back. */
  async respond(input: RespondInput): Promise<Draft> {
    const agent = await this.agentFor(input.child, input.app, input.sitting, input.persona ?? null);
    const { session } = agent;
    const manager = session.sessionManager;
    const leafBefore = manager.getLeafId();
    const turn: TurnState = {
      childId: input.child.profile.id,
      buddyId: input.buddyId ?? null,
      // The material is already fenced and cleaned (pipeline.ts); the server's instruction comes last.
      instruction: [input.material ?? "", actionInstruction(input.action, input.problem?.text ?? null, this.nonce)].filter(Boolean).join("\n\n"),
      fenceId: newFenceId(),
      action: input.action,
      problem: input.problem,
      calls: [],
      effects: [],
      onFlag: input.onFlag,
    };
    agent.turn = turn;
    const texts: string[] = [];
    let tokens = 0;
    const unsubscribe = session.subscribe((event: any) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") input.onDelta?.(event.assistantMessageEvent.delta);
      if (event.type === "message_end" && event.message?.role === "assistant") {
        tokens += tokensOf(event.message);
        // A failed message is dropped by Pi's retry, which carries on from the tool results already in the session
        // (tools never run twice); its partial text mustn't reach the reply.
        const t = event.message.stopReason === "error" ? "" : textOf(event.message);
        if (t) texts.push(t);
      }
    });
    let failure: string | null = null;
    try {
      // Shared files are saved as markers; withSharedFiles() loads them each time the conversation goes to the model.
      const text = [stripFileMarkers(sanitiseChildText(input.text)), ...(input.files ?? []).map(fileMarker)].filter(Boolean).join("\n");
      await session.prompt(text, { expandPromptTemplates: false });
      const last: any = session.messages.at(-1);
      if (last?.role === "assistant" && last.stopReason === "error") failure = String(last.errorMessage ?? "model error");
    } catch (e) {
      failure = (e as Error).message;
    } finally {
      unsubscribe();
      agent.turn = null;
    }
    const rollback = async () => {
      const entry = manager.getBranch().find((e: any) => e.parentId === leafBefore);
      if (entry) await session.navigateTree(entry.id);
    };
    if (failure) {
      await rollback();
      throw new Error(`Tutor model call failed: ${redact(failure)}`);
    }
    const text = texts.filter(Boolean).join("\n\n");
    const visibleText = [...turn.effects.map(effectVisibleText), text].filter(Boolean).join("\n\n");
    return { text, calls: turn.calls, effects: turn.effects, visibleText, tokens, piSessionId: manager.getSessionId(), rollback };
  }

  /** One structured call (forced tool, JSON schema). Used by the classifier and the leak check. */
  async completeStructured<T>(req: StructuredRequest): Promise<{ value: T | null; tokens: number; error?: string }> {
    const model = this.models[req.model];
    const toolChoice = forcedToolChoice(model.api, req.toolName);
    try {
      const msg: any = await this.runtime.complete(
        model,
        {
          systemPrompt: req.system,
          messages: [
            {
              role: "user",
              content: req.images?.length ? [...req.images.map((i) => ({ type: "image" as const, ...i })), { type: "text" as const, text: req.user }] : req.user,
              timestamp: Date.now(),
            },
          ],
          tools: [{ name: req.toolName, description: req.description, parameters: Type.Unsafe<any>(req.schema), constrainedSampling: { type: "json_schema", strict: "prefer" } }],
        },
        { maxTokens: req.maxTokens ?? 400, ...(toolChoice ? { toolChoice } : {}) } as any,
      );
      const tokens = tokensOf(msg);
      if (msg.stopReason === "error") return { value: null, tokens, error: redact(String(msg.errorMessage ?? "model error")) };
      const call = (msg.content ?? []).find((c: any) => c.type === "toolCall" && c.name === req.toolName);
      if (call) return { value: call.arguments as T, tokens };
      const text = textOf(msg);
      const json = text.match(/\{[\s\S]*\}/);
      if (json) {
        try {
          return { value: JSON.parse(json[0]) as T, tokens };
        } catch {}
      }
      return { value: null, tokens, error: "no structured output" };
    } catch (e) {
      return { value: null, tokens: 0, error: redact((e as Error).message) };
    }
  }

  get isFaux(): boolean {
    return this.faux !== null;
  }
}

/** Persisted so resumed sessions (whose saved system prompt names it) stay consistent across restarts. */
function householdNonce(dir: string): string {
  const path = join(dir, "data", "turn-nonce");
  if (existsSync(path)) {
    const v = readFileSync(path, "utf8").trim();
    if (v) return v;
  }
  const v = randomBytes(9).toString("base64url");
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(path, v, { mode: 0o600 });
  return v;
}

/** How each model API is told it must call the one tool it's given. Unknown APIs fall back to reading JSON from the text. */
function forcedToolChoice(api: string, name: string): unknown {
  switch (api) {
    case "anthropic-messages":
      return { type: "tool", name };
    case "openai-responses":
    case "azure-openai-responses":
      return { type: "function", name };
    case "openai-completions":
      return "required";
    case "google-generative-ai":
    case "google-vertex":
    case "mistral-conversations":
    case "bedrock-converse-stream":
      return "any";
    default:
      return undefined;
  }
}

function requireModel(runtime: ModelRuntime, ref: string) {
  const r = parseModelRef(ref);
  const model = r && runtime.getModel(r.provider, r.id);
  if (!model) throw new Error(`Unknown model "${ref}". Check models in openbuddies.yaml (provider/model).`);
  return model;
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Copy the messages, adding the instruction to the most recent user message. The originals are left untouched. */
/** The newest shared photos sent as images in one model call; older ones go as their transcription. */
const MAX_PHOTOS_IN_CONTEXT = 4;

/** A shared file, as the agent needs it: a photo's pixels and transcription, or a text file's text. */
export type FileSource = (childId: string, buddyId: number, fileId: number) => { kind: "image" | "text"; name: string; text: string | null; image?: { data: string; mimeType: string } } | null;

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n") : "";
}

function appendToLastUserMessage(messages: any[], instruction: string): any[] {
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (m?.role !== "user") continue;
    const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : [...(m.content ?? [])];
    out[i] = { ...m, content: [...content, { type: "text", text: instruction }] };
    return out;
  }
  return [...out, { role: "user", content: [{ type: "text", text: instruction }], timestamp: Date.now() }];
}
