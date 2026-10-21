import { createServer, type IncomingMessage, type Server } from "node:http";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer, type WebSocket } from "ws";
import QRCode from "qrcode";
import { cleanWear, FILE_LIMITS, isBuddyColor, isAutoFileName, type AppTile, type ClientEvent, type ParentChildOverview, type ServerEvent, type SubjectOption } from "../shared/protocol.js";
import { AgentHost, type FauxBackend, type FileSource } from "./agent.js";
import { allowedClient, allowedParent, isLoopback, normaliseIp, ParentAuth } from "./auth.js";
import { DefaultClassifier, type Classifier } from "./classifier.js";
import { validateBuddy } from "./buddies.js";
import { cleanFileName, detectFile, readImage, readTextFile, removeStoredFile, storeFile } from "./files.js";
import { clearMemory, MemoryKeeper, readMemory } from "./memory.js";
import { checkSubscription, PushSender } from "./push.js";
import { Scheduler } from "./schedules.js";
import { Heartbeat } from "./heartbeat.js";
import { answer as answerQuestion, QuizMaker, questionViews, review } from "./quizzes.js";
import { lookUp, searchProviderName } from "./web.js";
import { generateImage, imageProviders, planPicture } from "./pictures.js";
import { allowanceFor, appOn, loadHousehold, subjectLabel, SUGGESTED_SUBJECTS, untestedModels, watchHousehold, writeContextFiles, type AppConfig, type Household } from "./config.js";
import { addSubject, listSubjects, removeSubject, setAllowance, setDefaultMode, setAppFor, setCatalogues, setHeartbeat, setSubject, setWeb } from "./subjects.js";
import { gallery, installApp, previewApp, removeApp } from "./apps.js";
import { validateChild, writeChild } from "./children.js";
import { Db, type FileRow } from "./db.js";
import { codeVersion, householdId, packageRoot } from "./paths.js";
import { Pipeline, problemView, type PipelineDeps } from "./pipeline.js";
import { TUTOR_TOOL_NAMES } from "./tools.js";
import { bindAddresses, childBaseUrl } from "./network.js";

export interface StartOptions {
  home: string;
  port?: number;
  /** Only bind loopback (tests). */
  loopbackOnly?: boolean;
  faux?: FauxBackend;
  classifier?: Classifier;
  log?: (msg: string) => void;
  /** Look up Tailscale for URLs (default true). Tests turn it off. */
  detectTailscale?: boolean;
  /** Keep buddies' memory notes (default true). Tests that don't want background model calls turn it off. */
  memory?: boolean;
  /** Run the reminder scheduler's timer (default true). Tests drive it with scheduler.tick() instead. */
  scheduler?: boolean;
  /** Looking things up on the internet. Default: the household's search provider (web.ts). Tests pass a fake. */
  web?: PipelineDeps["web"];
  /** Picture Studio. Default: the household's image provider (pictures.ts). Tests swap in parts. */
  pictures?: Partial<NonNullable<PipelineDeps["pictures"]>>;
}

export interface RunningServer {
  port: number;
  household: () => Household;
  db: Db;
  memory: MemoryKeeper;
  scheduler: Scheduler;
  heartbeat: Heartbeat;
  close(): Promise<void>;
}

/** What the child's API knows about the request: the child and the paired device it came from. */
type ChildEnv = { Variables: { childId: string; deviceId: number } };

/** The app reminders and plans belong to: they go off in the buddy's homework chat. */
const SCHEDULE_APP = "homework";

const COMING_SOON: AppTile[] = [
  { id: "ask", name: "Ask Anything", description: "Curious about something? Just ask!", icon: "circle-help", live: false },
  { id: "revise", name: "Revise", description: "Make your own revision plan.", icon: "notebook-pen", live: false },
  { id: "progress", name: "Progress", description: "See what you're learning and achieving.", icon: "chart-column", live: false },
];

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/** The startup self-test: every child's session must expose exactly the six tutor tools. */
export async function checkSessionTools(agent: AgentHost, household: Household): Promise<{ ok: boolean; report: string[] }> {
  const expected = [...TUTOR_TOOL_NAMES].sort().join(",");
  const report: string[] = [];
  let ok = true;
  for (const child of household.children.values()) {
    for (const app of household.apps.values()) {
      const tools = await agent.sessionToolNames(child, app);
      const good = tools.join(",") === expected;
      ok &&= good;
      report.push(`${good ? "ok  " : "FAIL"} ${child.profile.id}/${app.id}: ${tools.join(", ") || "(none)"}`);
    }
  }
  // A self-test that checked nothing must not pass.
  if (!household.children.size || !household.apps.size) {
    ok = false;
    report.push("no children or apps loaded, so nothing could be checked");
    for (const e of household.errors) report.push(`config: ${e}`);
  }
  return { ok, report };
}

/**
 * The client's address. Behind Tailscale Serve every request arrives from loopback, so the real tailnet address is
 * taken from X-Forwarded-For, but only when the TCP peer is loopback: a LAN device can't spoof it.
 */
export function clientIp(peer: string | undefined, forwardedFor: string | undefined): string {
  const ip = normaliseIp(peer);
  if (isLoopback(ip) && forwardedFor) {
    const first = normaliseIp(forwardedFor.split(",")[0].trim());
    if (first) return first;
  }
  return ip;
}

function remoteIp(c: Context): string {
  return clientIp((c.env as { incoming?: IncomingMessage })?.incoming?.socket?.remoteAddress, c.req.header("x-forwarded-for"));
}

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const log = opts.log ?? ((m: string) => console.log(`[${new Date().toISOString()}] ${m}`));
  let household = loadHousehold(opts.home);
  for (const e of household.errors) log(`config: ${e}`);
  writeContextFiles(household);
  const db = new Db(join(household.dir, "data", "openbuddies.db"));
  db.syncChildren([...household.children.values()].map((c) => ({ id: c.profile.id, name: c.profile.name })));

  const agent = await AgentHost.create(household, { faux: opts.faux });
  const selfTest = await checkSessionTools(agent, household);
  if (!selfTest.ok) {
    agent.dispose();
    db.close();
    throw new Error(`Self-test failed: sessions must expose exactly the six tutor tools.\n${selfTest.report.join("\n")}`);
  }
  log(`self-test passed: ${selfTest.report.length} session(s) expose only the tutor tools`);
  const untested = untestedModels(household.config.models);
  if (untested) log(`warning: ${untested}`);

  const port = opts.port ?? household.config.port;
  const sockets = new Map<string, Set<{ ws: WebSocket; deviceId: number }>>();
  const emit = (childId: string, event: ServerEvent) => {
    const data = JSON.stringify(event);
    for (const s of sockets.get(childId) ?? []) if (s.ws.readyState === s.ws.OPEN) s.ws.send(data);
  };
  /** Tell the child's devices their buddies changed. If the active buddy changed, send them that buddy's chat. */
  const buddiesChanged = (childId: string, before: number | null) => {
    const activeBuddyId = db.activeBuddyId(childId);
    emit(childId, { type: "buddies", buddies: db.listBuddies(childId), activeBuddyId, subjects: subjectOptions(childId) });
    // Devices switching buddy ask for the new buddy's chat themselves (sync), for whichever app they're showing.
  };
  /** A child added a subject while making a buddy: it follows their help level, and the parent can change or remove it. */
  const addSubjectFor = (childId: string, subject: string) => {
    const child = household.children.get(childId);
    if (!child) return;
    addSubject(child.dir, subject);
    log(`subject ${subject} added by ${childId} for a buddy`);
    reload();
  };
  // ---- a buddy's files ----
  const filesChanged = (childId: string, buddyId: number) => emit(childId, { type: "files", buddyId, files: db.listFiles(buddyId) });
  /** Read a new file for the buddy: a photo is transcribed by the check model in the background. */
  const nameFromSummary = (id: number) => {
    const f = db.fileById(id);
    if (!f?.summary || !isAutoFileName(f.name)) return;
    const ext = f.path.split(".").pop() ?? "jpg";
    db.renameFile(id, cleanFileName(`${f.summary.replace(/:\s*/g, " - ").replace(/[\\/]/g, "-")}.${ext}`, ext));
  };
  // Files kept before photos were named this way.
  for (const id of db.autoNamedFiles()) if (isAutoFileName(db.fileById(id)?.name ?? "")) nameFromSummary(id);
  const readNewFile = async (id: number, buf: Buffer, mime: string) => {
    const f = db.fileById(id);
    if (!f) return;
    const child = household.children.get(f.childId);
    if (!child || db.usageToday(f.childId) >= allowanceFor(household, child)) {
      db.setFileRead(id, { status: "failed", text: null, summary: "Couldn't read it today: OpenBuddies is resting until tomorrow." });
    } else {
      const res = await readImage(agent, buf, mime).catch(() => ({ text: null, summary: null, tokens: 0 }));
      db.addUsage(f.childId, res.tokens);
      db.setFileRead(id, res.text ? { status: "ready", text: res.text, summary: res.summary } : { status: "failed", text: null, summary: "Couldn't read this photo. Try a clearer one." });
      // A camera's made-up name ("IMG_1234.jpg") becomes what the photo shows ("History homework - the Tudors.jpg").
      if (res.summary) nameFromSummary(id);
    }
    filesChanged(f.childId, f.buddyId);
  };
  /** Add an upload to a buddy. Returns an error message for the child, or the new file's id. */
  const addFileFor = (childId: string, buddyId: number, buf: Buffer, rawName: string): { error: string } | { id: number } => {
    const buddy = db.buddyById(buddyId);
    if (!buddy || buddy.deleted || buddy.childId !== childId) return { error: "unknown buddy" };
    if (db.listFiles(buddyId).length >= FILE_LIMITS.perBuddy) return { error: `${buddy.name} can keep up to ${FILE_LIMITS.perBuddy} files. Remove one to add another.` };
    if (!buf.length || buf.length > FILE_LIMITS.maxBytes) return { error: "That file is too big. Try a smaller photo." };
    const type = detectFile(buf, rawName);
    if (!type) return { error: "OpenBuddies can keep photos (JPEG, PNG, WebP) and text files (.txt, .md)." };
    const name = cleanFileName(rawName, type.ext);
    const path = storeFile(household.dir, childId, buddyId, buf, type.ext);
    if (type.kind === "text") {
      const read = readTextFile(buf);
      const id = db.addFile({ buddyId, childId, name, kind: "text", mime: type.mime, size: buf.length, path, status: "ready", ...read });
      filesChanged(childId, buddyId);
      log(`file ${id} added to buddy ${buddyId} for ${childId}`);
      return { id };
    }
    const id = db.addFile({ buddyId, childId, name, kind: "image", mime: type.mime, size: buf.length, path, status: "reading" });
    filesChanged(childId, buddyId);
    void readNewFile(id, buf, type.mime);
    log(`file ${id} added to buddy ${buddyId} for ${childId}`);
    return { id };
  };
  /** A picture from Picture Studio, kept in the buddy's files like a photo the child added. */
  const keepPicture = (childId: string, buddyId: number, image: { data: Buffer; mime: string }, title: string, prompt: string): { id: number; name: string } | { error: string } => {
    if (db.listFiles(buddyId).length >= FILE_LIMITS.perBuddy) return { error: `Your files are full! Remove one to keep more pictures.` };
    const type = detectFile(image.data, "picture.png");
    if (type?.kind !== "image" || image.data.length > 10 * 1024 * 1024) return { error: "That one didn't work out. Shall we try a different idea?" };
    const name = cleanFileName(`${title}.${type.ext}`, type.ext);
    const path = storeFile(household.dir, childId, buddyId, image.data, type.ext);
    const id = db.addFile({ buddyId, childId, name, kind: "image", mime: type.mime, size: image.data.length, path, status: "ready", summary: `Picture: ${title}`, text: `A picture made in Picture Studio, showing: ${prompt}` });
    filesChanged(childId, buddyId);
    log(`picture ${id} made for ${childId}`);
    return { id, name };
  };
  const removeFile = (id: number) => {
    const f = db.fileById(id);
    if (!f) return false;
    db.deleteFile(id);
    fileCache.delete(id);
    removeStoredFile(household.dir, f.path);
    filesChanged(f.childId, f.buddyId);
    return true;
  };
  /** A removed buddy's files and memory go with it. */
  /**
   * Remove a buddy and everything it kept: its files (bytes and records, including what was read from photos), its
   * folder, its memory notes, its reminders and plans, and anything it had to tell the child. Its chats stay in Sessions
   * for the parent. False if it can't be removed (it's the main buddy, or not this child's).
   */
  const removeBuddy = (childId: string, buddyId: number): boolean => {
    if (!db.deleteBuddy(childId, buddyId)) return false;
    for (const f of db.listFiles(buddyId)) removeFile(f.id);
    rmSync(join(household.dir, "data", "files", childId, String(buddyId)), { recursive: true, force: true });
    clearMemory(household.dir, childId, buddyId);
    db.purgeBuddy(buddyId);
    emit(childId, { type: "schedules", schedules: scheduler.list(childId) });
    emit(childId, { type: "nudges", nudges: db.unseenNudges(childId) });
    log(`buddy ${buddyId} removed for ${childId}, with its files, notes and reminders`);
    return true;
  };
  const sendBuddyFile = (c: Context, f: FileRow) => {
    const full = join(household.dir, f.path);
    if (!existsSync(full)) return c.json({ error: "not found" }, 404);
    return c.body(readFileSync(full), 200, {
      "Content-Type": f.mime,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
  };

  const subjectOptions = (childId: string): SubjectOption[] =>
    (household.children.get(childId)?.profile.subjects ?? []).map((name) => ({ name, label: subjectLabel(name) }));

  // Shared files are loaded from disk when the conversation goes to the model; recent ones are kept in memory.
  const fileCache = new Map<number, ReturnType<FileSource>>();
  agent.setFileSource((childId, buddyId, id) => {
    const f = db.fileById(id);
    if (!f || f.childId !== childId || f.buddyId !== buddyId || f.status !== "ready") return null;
    if (!fileCache.has(id)) {
      const full = join(household.dir, f.path);
      const image = f.kind === "image" && existsSync(full) ? { data: readFileSync(full).toString("base64"), mimeType: f.mime } : undefined;
      fileCache.set(id, { kind: f.kind, name: f.name, text: f.text, image });
      if (fileCache.size > 24) fileCache.delete(fileCache.keys().next().value!);
    }
    return fileCache.get(id)!;
  });
  const memory = new MemoryKeeper({
    db,
    model: agent,
    home: () => household.dir,
    idleMinutes: () => household.config.session_idle_minutes,
    enabled: opts.memory ?? true,
    log,
  });
  const stopMemory = memory.start();

  const classifier = opts.classifier ?? new DefaultClassifier(agent);
  // Quizzes a buddy makes, in the background (quizzes.ts).
  const quizzes = new QuizMaker({
    db,
    household: () => household,
    check: agent,
    tutor: agent,
    leakCheck: (problem, text) => classifier.leakCheck(problem, text, "make me a quiz"),
    post: (childId, buddyId, app, text, item) => pipeline.post(childId, buddyId, app, text, item),
    changed: (childId, buddyId) => emit(childId, { type: "quizzes", buddyId }),
    making: (childId, buddyId, app, quiz) => pipeline.quizzing(childId, buddyId, app, quiz),
    log,
  });

  const pipeline = new Pipeline({
    db,
    tutor: agent,
    classifier,
    quizzes: { request: (childId, buddyId, app, conversation) => quizzes.request(childId, buddyId, app, conversation) },
    household: () => household,
    emit,
    memory,
    schedules: { propose: (childId, buddyId, text) => scheduler.propose(childId, buddyId, text), list: (childId) => scheduler.list(childId) },
    pictures: {
      available: () => imageProviders(household.images).length > 0,
      plan: (conversation, last) => planPicture(agent, conversation, last),
      draw: (prompt, base) => generateImage(household.images, prompt, base),
      load: (fileId) => {
        const f = db.fileById(fileId);
        const full = f && join(household.dir, f.path);
        return f && full && existsSync(full) ? { data: readFileSync(full), mime: f.mime } : null;
      },
      keep: (childId, buddyId, image, title, prompt) => keepPicture(childId, buddyId, image, title, prompt),
      // Tests swap in their own planner and image model.
      ...opts.pictures,
    },
    web: opts.web ?? {
      available: () => !!searchProviderName(household.search),
      lookUp: (child, question, query) => lookUp({ search: household.search, model: agent }, child, question, query),
    },
    streamDelayMs: opts.faux ? 0 : 25,
    log,
  });

  /** Something a buddy said on its own: kept until the child opens its chat, for the home screen's speech bubble. */
  const nudge = (childId: string, buddyId: number, kind: "reminder" | "plan" | "checkin", text: string) => {
    db.addNudge(childId, buddyId, kind, text);
    emit(childId, { type: "nudges", nudges: db.unseenNudges(childId) });
  };

  // Reminders and plans: the buddy's chat, and a notification on the child's devices.
  const push = new PushSender(db, () => household.dir, log);
  const scheduler = new Scheduler({
    db,
    household: () => household,
    model: agent,
    deliver: async (childId, s, useModel) => {
      let said = s.text;
      const turn = useModel ? await pipeline.runScheduled(childId, SCHEDULE_APP, s).catch(() => null) : null;
      if (turn?.reply) said = turn.reply;
      // No model (or it failed): the reminder still lands, as it is.
      else pipeline.remind(childId, SCHEDULE_APP, s);
      nudge(childId, s.buddyId, s.kind === "task" ? "plan" : "reminder", said);
      return said;
    },
    notify: (childId, n) => push.notify(childId, n),
    emit: (childId, schedules) => emit(childId, { type: "schedules", schedules }),
    log,
  });
  const stopScheduler = opts.scheduler === false ? () => {} : scheduler.start();
  // Once a day, a buddy may check in with something timely (heartbeat.ts).
  const heartbeat = new Heartbeat({
    db,
    household: () => household,
    model: agent,
    schedules: scheduler,
    deliver: (childId, buddyId, text) => {
      pipeline.checkIn(childId, buddyId, text);
      nudge(childId, buddyId, "checkin", text);
    },
    notify: (childId, n) => push.notify(childId, n),
    log,
  });
  const stopHeartbeat = opts.scheduler === false ? () => {} : heartbeat.start();

  const reload = () => {
    try {
      const next = loadHousehold(household.dir);
      for (const e of next.errors) log(`config: ${e}`);
      household = next;
      writeContextFiles(household);
      db.syncChildren([...household.children.values()].map((c) => ({ id: c.profile.id, name: c.profile.name })));
      agent.reload(household);
      // Apps may have been added, removed or switched: every child's devices get their current list.
      for (const id of household.children.keys()) emit(id, { type: "apps", apps: childApps(id) });
      log("household reloaded");
    } catch (e) {
      log(`reload failed, keeping previous config: ${(e as Error).message}`);
    }
  };
  const stopWatching = watchHousehold(household.dir, reload);

  const parentAuth = new ParentAuth(() => household.config.parent.pin_hash);
  const app = new Hono();

  app.use("*", async (c, next) => {
    if (!allowedClient(remoteIp(c))) return c.text("Forbidden", 403);
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
  });

  // On this computer, also say which household, code and process this is (for `openbuddies start` and `status`).
  const identity = { home: household.dir, householdId: householdId(household.dir), code: codeVersion(), pid: process.pid };
  app.get("/api/health", (c) => c.json(isLoopback(normaliseIp(remoteIp(c))) ? { ok: true, name: "openbuddies", ...identity } : { ok: true, name: "openbuddies" }));

  // ---- a child's files, from their paired device (device token as a bearer token) ----
  const child = new Hono<ChildEnv>();
  child.use("*", async (c, next) => {
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const device = token ? db.deviceByToken(token) : null;
    if (!device) return c.json({ error: "This device isn't paired." }, 401);
    c.set("childId", device.child_id);
    c.set("deviceId", device.id);
    await next();
  });
  const ownBuddy = (c: Context<ChildEnv>) => {
    const b = db.buddyById(Number(c.req.param("buddyId")));
    return b && !b.deleted && b.childId === c.get("childId") ? b : null;
  };
  const ownFile = (c: Context<ChildEnv>) => {
    const f = db.fileById(Number(c.req.param("id")));
    return f && f.childId === c.get("childId") ? f : null;
  };
  child.get("/buddies/:buddyId/files", (c) => (ownBuddy(c) ? c.json(db.listFiles(Number(c.req.param("buddyId")))) : c.json({ error: "unknown buddy" }, 404)));
  const tooBig = bodyLimit({
    maxSize: FILE_LIMITS.maxBytes,
    onError: (c) => {
      log(`upload refused for buddy ${c.req.param("buddyId")}: over ${FILE_LIMITS.maxBytes} bytes`);
      return c.json({ error: "That file is too big. Try a smaller photo." }, 413);
    },
  });
  child.post("/buddies/:buddyId/files", tooBig, async (c) => {
    if (!ownBuddy(c)) return c.json({ error: "unknown buddy" }, 404);
    const buf = Buffer.from(await c.req.arrayBuffer());
    const res = addFileFor(c.get("childId"), Number(c.req.param("buddyId")), buf, c.req.query("name") ?? "");
    // Say why in the log: a refused upload otherwise leaves no trace on the server.
    if ("error" in res) log(`upload refused for buddy ${c.req.param("buddyId")} (${buf.length} bytes, "${(c.req.query("name") ?? "").slice(0, 60)}"): ${res.error}`);
    return "error" in res ? c.json(res, 400) : c.json(db.fileById(res.id) ? db.listFiles(Number(c.req.param("buddyId"))).find((f) => f.id === res.id) : null, 201);
  });
  child.get("/buddies/:buddyId/memory", (c) => {
    const b = ownBuddy(c);
    return b ? c.json(readMemory(household.dir, b.childId, b.id) ?? { text: null }) : c.json({ error: "unknown buddy" }, 404);
  });
  // Notifications on this device (Web Push). The browser only allows them over HTTPS.
  child.get("/push", (c) => c.json({ publicKey: push.publicKey(), subscribed: db.hasPushSubscription(c.get("deviceId")) }));
  child.post("/push", async (c) => {
    const sub = checkSubscription(await c.req.json().catch(() => null));
    if (!sub) return c.json({ error: "That notification address isn't one OpenBuddies can use." }, 400);
    db.addPushSubscription(c.get("deviceId"), sub.endpoint, sub.keys);
    log(`notifications on for device ${c.get("deviceId")}`);
    return c.json({ ok: true });
  });
  child.delete("/push", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.endpoint === "string") db.removePushSubscription(body.endpoint, c.get("deviceId"));
    return c.json({ ok: true });
  });
  child.delete("/buddies/:buddyId/memory", (c) => {
    const b = ownBuddy(c);
    if (!b) return c.json({ error: "unknown buddy" }, 404);
    clearMemory(household.dir, b.childId, b.id);
    db.setMemoryTurnId(b.id, db.lastTurnId(b.childId));
    return c.json({ ok: true });
  });
  child.get("/files/:id", (c) => {
    const f = ownFile(c);
    return f ? sendBuddyFile(c, f) : c.json({ error: "not found" }, 404);
  });
  // Quizzes: the buddy's list, and taking one. The device gets questions only; answers are checked here.
  const ownQuiz = (c: Context<ChildEnv>, id: number) => {
    const q = db.quiz(id);
    return q && q.childId === c.get("childId") ? q : null;
  };
  child.get("/buddies/:buddyId/quizzes", (c) => (ownBuddy(c) ? c.json(db.listQuizzes(Number(c.req.param("buddyId")))) : c.json({ error: "unknown buddy" }, 404)));
  child.post("/quizzes/:id/attempts", (c) => {
    const q = ownQuiz(c, Number(c.req.param("id")));
    if (!q || q.status !== "ready") return c.json({ error: "That quiz isn't ready." }, 404);
    return c.json({ attemptId: db.startAttempt(q.id, q.questions.length), title: q.title, style: q.style, questions: questionViews(q.questions) });
  });
  const ownAttempt = (c: Context<ChildEnv>) => {
    const a = db.attempt(Number(c.req.param("id")));
    const q = a && ownQuiz(c, a.quizId);
    return a && q && !a.finished ? { a, q } : null;
  };
  child.post("/attempts/:id/answer", async (c) => {
    const found = ownAttempt(c);
    if (!found) return c.json({ error: "That quiz try is over." }, 404);
    const body = await c.req.json().catch(() => ({}));
    const n = Number(body.n);
    const question = found.q.questions[n];
    if (!question || typeof body.answer !== "string" || !body.answer.trim()) return c.json({ error: "Pick or type an answer." }, 400);
    const checked = answerQuestion(question, found.a.answers[n], body.answer);
    if (!checked) return c.json({ error: "You've finished that question." }, 409);
    const answers = [...found.a.answers];
    answers[n] = checked.state;
    db.saveAttempt(found.a.id, answers);
    return c.json(checked.result);
  });
  child.post("/attempts/:id/finish", (c) => {
    const found = ownAttempt(c);
    if (!found) return c.json({ error: "That quiz try is over." }, 404);
    const result = review(found.q.questions, found.a.answers);
    db.finishAttempt(found.a.id, result.score);
    // The buddy (and the parent) see how it went, in the chat the quiz came from.
    pipeline.post(found.q.childId, found.q.buddyId, found.q.app, `You got ${result.score} out of ${result.total} on "${found.q.title}"!`, {
      kind: "quiz_result",
      quizId: found.q.id,
      title: found.q.title ?? found.q.topic,
      score: result.score,
      total: result.total,
    });
    emit(found.q.childId, { type: "quizzes", buddyId: found.q.buddyId });
    return c.json(result);
  });
  child.delete("/quizzes/:id", (c) => {
    const q = ownQuiz(c, Number(c.req.param("id")));
    if (!q) return c.json({ error: "not found" }, 404);
    db.deleteQuiz(q.id);
    emit(q.childId, { type: "quizzes", buddyId: q.buddyId });
    return c.json({ ok: true });
  });
  child.patch("/files/:id", async (c) => {
    const f = ownFile(c);
    if (!f) return c.json({ error: "not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const ext = f.path.split(".").pop() ?? "txt";
    const raw = typeof body.name === "string" ? body.name.trim() : "";
    if (!raw) return c.json({ error: "Give it a name." }, 400);
    // Same cleaning as an upload, and it keeps its real type: renaming can't turn a photo into anything else.
    const name = cleanFileName(raw.replace(/\.[^.]*$/, "") + `.${ext}`, ext);
    db.renameFile(f.id, name);
    filesChanged(f.childId, f.buddyId);
    return c.json(db.listFiles(f.buddyId).find((x) => x.id === f.id));
  });
  child.delete("/files/:id", (c) => {
    const f = ownFile(c);
    return f && removeFile(f.id) ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });
  app.route("/api/child", child);

  app.post("/api/pair", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.token !== "string") return c.json({ error: "missing token" }, 400);
    const res = db.redeemPairingToken(body.token, String(body.deviceName ?? "Device"));
    if (!res) return c.json({ error: "This pairing code has expired or was already used. Ask your parent for a new one." }, 410);
    const child = household.children.get(res.childId);
    log(`device ${res.deviceId} paired for ${res.childId}`);
    return c.json({ deviceToken: res.deviceToken, child: { id: res.childId, name: child?.profile.name ?? res.childId } });
  });

  // ---- parent API: localhost or Tailscale, PIN session required ----
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    if (!allowedParent(remoteIp(c))) return c.json({ error: "The parent page is only available on this computer or over Tailscale." }, 403);
    if (c.req.path.endsWith("/login")) return next();
    if (!parentAuth.check(getCookie(c, "tb_parent"))) return c.json({ error: "login required" }, 401);
    await next();
  });
  parent.post("/login", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const res = await parentAuth.login(remoteIp(c), String(body.pin ?? ""));
    if (!res.ok) {
      if (res.retryAfter) c.header("Retry-After", String(res.retryAfter));
      return c.json({ error: res.status === 429 ? `Too many tries. Wait ${Math.ceil((res.retryAfter ?? 60) / 60)} minutes.` : "Wrong PIN" }, res.status);
    }
    setCookie(c, "tb_parent", res.token, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: ParentAuth.SESSION_MS / 1000 });
    return c.json({ ok: true });
  });
  parent.post("/logout", (c) => {
    parentAuth.logout(getCookie(c, "tb_parent"));
    deleteCookie(c, "tb_parent", { path: "/" });
    return c.json({ ok: true });
  });
  parent.get("/me", (c) =>
    c.json({
      parentName: household.config.parent.name,
      children: [...household.children.values()].map((ch) => ({ id: ch.profile.id, name: ch.profile.name })),
    }),
  );
  const childView = (id: string) => {
    const ch = household.children.get(id)!;
    return {
      id,
      name: ch.profile.name,
      age: ch.profile.age,
      year: ch.profile.year,
      mode: ch.rules.default_mode,
      subjects: listSubjects(ch.dir, id),
      buddies: db.listBuddies(id),
      allowance: { own: ch.rules.daily_tokens ?? null, household: household.config.budget.daily_tokens_per_child, usedToday: db.usageToday(id) },
      heartbeat: ch.rules.heartbeat,
      web: { ...ch.rules.web, provider: searchProviderName(household.search) },
    };
  };
  parent.get("/children", (c) => c.json({ children: [...household.children.keys()].map(childView), suggested: SUGGESTED_SUBJECTS }));
  parent.put("/children/:id/subjects/:name", async (c) => {
    const child = household.children.get(c.req.param("id"));
    if (!child) return c.json({ error: "unknown child" }, 404);
    const body = await c.req.json().catch(() => ({}));
    try {
      const name = setSubject(child.dir, c.req.param("name"), body.mode ?? "strict");
      log(`subject ${name} set to ${body.mode ?? "strict"} for ${child.profile.id}`);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    reload();
    buddiesChanged(child.profile.id, db.activeBuddyId(child.profile.id));
    return c.json(childView(child.profile.id));
  });
  parent.put("/children/:id/mode", async (c) => {
    const child = household.children.get(c.req.param("id"));
    if (!child) return c.json({ error: "unknown child" }, 404);
    const body = await c.req.json().catch(() => ({}));
    try {
      setDefaultMode(child.dir, body.mode);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    log(`help level for ${child.profile.id} set to ${body.mode}`);
    reload();
    return c.json(childView(child.profile.id));
  });
  // A child's own daily token allowance, or { tokens: null } to use the household's.
  parent.put("/children/:id/allowance", async (c) => {
    const child = household.children.get(c.req.param("id"));
    if (!child) return c.json({ error: "unknown child" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const tokens = body.tokens === null ? null : Number(body.tokens);
    try {
      setAllowance(child.dir, tokens);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    log(`daily allowance for ${child.profile.id} set to ${tokens ?? "the household default"}`);
    reload();
    return c.json(childView(child.profile.id));
  });
  parent.post("/children", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const spec = {
      name: String(body.name ?? ""),
      age: Number(body.age),
      year: String(body.year ?? ""),
      mode: body.mode,
    };
    const error = validateChild(spec);
    if (error) return c.json({ error }, 400);
    let id: string;
    try {
      id = writeChild(household.dir, spec);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    log(`child ${id} added from the parent page`);
    reload();
    return c.json(childView(id), 201);
  });
  parent.put("/children/:id/buddies/:buddyId", async (c) => {
    const id = c.req.param("id");
    const child = household.children.get(id);
    if (!child) return c.json({ error: "unknown child" }, 404);
    const buddy = validateBuddy(await c.req.json().catch(() => ({})), child.profile.subjects);
    if ("error" in buddy) return c.json(buddy, 400);
    if (!db.updateBuddy(id, Number(c.req.param("buddyId")), buddy)) return c.json({ error: "unknown buddy" }, 404);
    if (buddy.newSubject) addSubjectFor(id, buddy.newSubject);
    log(`buddy ${c.req.param("buddyId")} changed from the parent page for ${id}`);
    buddiesChanged(id, db.activeBuddyId(id));
    return c.json(childView(id));
  });
  parent.delete("/children/:id/buddies/:buddyId", (c) => {
    const id = c.req.param("id");
    if (!household.children.has(id)) return c.json({ error: "unknown child" }, 404);
    const before = db.activeBuddyId(id);
    if (!removeBuddy(id, Number(c.req.param("buddyId")))) return c.json({ error: "That buddy can't be removed. A child always keeps their main buddy." }, 400);
    buddiesChanged(id, before);
    return c.json(childView(id));
  });
  parent.delete("/children/:id/subjects/:name", (c) => {
    const child = household.children.get(c.req.param("id"));
    if (!child) return c.json({ error: "unknown child" }, 404);
    try {
      log(`subject ${removeSubject(child.dir, c.req.param("name"))} removed for ${child.profile.id}`);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    reload();
    buddiesChanged(child.profile.id, db.activeBuddyId(child.profile.id));
    return c.json(childView(child.profile.id));
  });
  // The parent's overview: each child, their buddies, and totals for both.
  parent.get("/overview", (c) =>
    c.json({
      children: [...household.children.values()].map((ch): ParentChildOverview => {
        const id = ch.profile.id;
        return {
          id,
          name: ch.profile.name,
          age: ch.profile.age,
          year: ch.profile.year,
          mode: ch.rules.default_mode,
          stats: db.sessionStats(id),
          usage: { today: db.usageToday(id), budget: allowanceFor(household, ch) },
          buddies: db.listBuddies(id).map((b) => ({ ...b, stats: db.sessionStats(id, b.id) })),
        };
      }),
    }),
  );
  parent.get("/sessions", (c) => {
    const buddy = c.req.query("buddy");
    return c.json(db.listSessions({ childId: c.req.query("child") || undefined, buddyId: buddy ? Number(buddy) : undefined }));
  });
  parent.get("/sessions/:id", (c) => {
    const id = Number(c.req.param("id"));
    const s = db.sql.prepare("SELECT s.*, c.name AS child_name FROM sessions s JOIN children c ON c.id = s.child_id WHERE s.id = ?").get(id) as any;
    if (!s) return c.json({ error: "not found" }, 404);
    return c.json({
      session: { id: s.id, childId: s.child_id, childName: s.child_name, app: s.app, startedAt: s.started_at, endedAt: s.ended_at, buddy: db.buddyById(s.buddy_id) },
      problems: db.sessionProblems(id),
      turns: db.transcript(id),
    });
  });
  parent.get("/children/:id/buddies/:buddyId/quizzes", (c) => {
    const b = db.buddyById(Number(c.req.param("buddyId")));
    return b && b.childId === c.req.param("id") ? c.json(db.listQuizzes(b.id)) : c.json({ error: "unknown buddy" }, 404);
  });
  parent.get("/children/:id/buddies/:buddyId/files", (c) => {
    const b = db.buddyById(Number(c.req.param("buddyId")));
    return b && b.childId === c.req.param("id") ? c.json(db.listFiles(b.id)) : c.json({ error: "unknown buddy" }, 404);
  });
  parent.get("/children/:id/buddies/:buddyId/memory", (c) => {
    const b = db.buddyById(Number(c.req.param("buddyId")));
    return b && b.childId === c.req.param("id") ? c.json(readMemory(household.dir, b.childId, b.id) ?? { text: null }) : c.json({ error: "unknown buddy" }, 404);
  });
  parent.delete("/children/:id/buddies/:buddyId/memory", (c) => {
    const b = db.buddyById(Number(c.req.param("buddyId")));
    if (!b || b.childId !== c.req.param("id")) return c.json({ error: "unknown buddy" }, 404);
    clearMemory(household.dir, b.childId, b.id);
    // Start again from now, rather than rebuilding the notes from the whole history.
    db.setMemoryTurnId(b.id, db.lastTurnId(b.childId));
    log(`memory cleared for buddy ${b.id}`);
    return c.json({ ok: true });
  });
  parent.get("/files/:id", (c) => {
    const f = db.fileById(Number(c.req.param("id")));
    return f ? sendBuddyFile(c, f) : c.json({ error: "not found" }, 404);
  });
  parent.delete("/files/:id", (c) => (removeFile(Number(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "not found" }, 404)));
  parent.get("/alerts", (c) => c.json(db.listAlerts()));
  parent.post("/alerts/:id/read", (c) => {
    db.markAlertRead(Number(c.req.param("id")));
    return c.json({ ok: true });
  });
  // A child's reminders and plans: the parent sees them all and can pause, resume or delete any.
  parent.get("/children/:id/schedules", (c) => (household.children.has(c.req.param("id")) ? c.json(scheduler.list(c.req.param("id"))) : c.json({ error: "unknown child" }, 404)));
  parent.put("/schedules/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const childId = db.scheduleChild(id);
    const body = await c.req.json().catch(() => ({}));
    if (!childId || !["pause", "resume", "delete"].includes(body.action)) return c.json({ error: "unknown reminder or action" }, 400);
    if (!scheduler.act(childId, id, body.action)) return c.json({ error: "That reminder can't be changed now." }, 409);
    log(`reminder ${id} for ${childId}: ${body.action} by parent`);
    return c.json(scheduler.list(childId));
  });
  parent.put("/children/:id/web", async (c) => {
    const child = household.children.get(c.req.param("id"));
    if (!child) return c.json({ error: "unknown child" }, 404);
    const body = await c.req.json().catch(() => ({}));
    try {
      setWeb(child.dir, body);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    log(`internet settings for ${child.profile.id} changed`);
    reload();
    return c.json(childView(child.profile.id));
  });
  parent.put("/children/:id/heartbeat", async (c) => {
    const child = household.children.get(c.req.param("id"));
    if (!child) return c.json({ error: "unknown child" }, 404);
    const body = await c.req.json().catch(() => ({}));
    try {
      setHeartbeat(child.dir, body);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    reload();
    return c.json(childView(child.profile.id));
  });
  // Apps: what's installed and who has each, the gallery, and adding apps after the parent has read them.
  const appView = (a: AppConfig) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    author: a.author,
    version: a.version,
    kind: a.kind,
    needs: a.needs,
    source: a.source,
    origin: a.origin,
    art: a.art,
    icon: a.icon,
    children: [...household.children.values()].map((c) => ({ id: c.profile.id, name: c.profile.name, on: appOn(c, a) })),
  });
  parent.get("/apps", async (c) =>
    c.json({ apps: [...household.apps.values()].map(appView), gallery: await gallery(household), catalogues: household.config.catalogues }),
  );
  parent.post("/apps/preview", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json(await previewApp(String(body.source ?? ""), household));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
  parent.post("/apps/install", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const id = await installApp(String(body.source ?? ""), String(body.sha256 ?? ""), household);
      for (const childId of Array.isArray(body.children) ? body.children : []) {
        const child = household.children.get(String(childId));
        if (child) setAppFor(child.dir, id, true);
      }
      log(`app ${id} added from ${String(body.source).slice(0, 120)}`);
      reload();
      return c.json(appView(household.apps.get(id)!));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
  parent.delete("/apps/:id", (c) => {
    try {
      removeApp(c.req.param("id"), household);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    log(`app ${c.req.param("id")} removed`);
    reload();
    return c.json({ ok: true });
  });
  parent.put("/children/:id/apps/:appId", async (c) => {
    const child = household.children.get(c.req.param("id"));
    const app = household.apps.get(c.req.param("appId"));
    if (!child || !app) return c.json({ error: "unknown child or app" }, 404);
    const body = await c.req.json().catch(() => ({}));
    setAppFor(child.dir, app.id, body.on === true);
    reload();
    return c.json(appView(household.apps.get(app.id)!));
  });
  parent.put("/apps/catalogues", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      setCatalogues(household.dir, Array.isArray(body.urls) ? body.urls.map(String) : []);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    reload();
    return c.json({ catalogues: household.config.catalogues });
  });

  parent.get("/devices", (c) => c.json(db.listDevices()));
  parent.post("/devices/:id/revoke", (c) => {
    const id = Number(c.req.param("id"));
    const device = db.deviceById(id);
    if (!device) return c.json({ error: "not found" }, 404);
    db.revokeDevice(id);
    db.removeDevicePushSubscriptions(id);
    for (const s of sockets.get(device.child_id) ?? []) {
      if (s.deviceId !== id) continue;
      s.ws.send(JSON.stringify({ type: "revoked" } satisfies ServerEvent));
      s.ws.close(4001, "revoked");
    }
    log(`device ${id} revoked`);
    return c.json({ ok: true });
  });
  parent.post("/pair", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const childId = String(body.childId ?? "");
    if (!household.children.has(childId)) return c.json({ error: "unknown child" }, 404);
    const token = db.createPairingToken(childId);
    const base = opts.detectTailscale === false ? `http://localhost:${port}` : (await childBaseUrl(port)).base;
    const url = `${base}/pair?token=${token}`;
    return c.json({ url, svg: await QRCode.toString(url, { type: "svg", margin: 1 }), expiresInMinutes: 10 });
  });
  app.route("/api/parent", parent);

  // ---- the PWA ----
  const webRoot = join(packageRoot(), "dist", "web");
  const sendFile = (c: Context, path: string) => {
    const body = readFileSync(path);
    const type = MIME[extname(path)] ?? "application/octet-stream";
    const cache = path.includes(`${join("dist", "web", "assets")}`) ? "public, max-age=31536000, immutable" : "no-cache";
    return c.body(body, 200, { "Content-Type": type, "Cache-Control": cache });
  };
  app.get("*", (c) => {
    const path = c.req.path;
    if (path.startsWith("/api/")) return c.json({ error: "not found" }, 404);
    if (path.startsWith("/parent") && !allowedParent(remoteIp(c))) {
      return c.html("<h1>Not here</h1><p>The parent page only opens on the OpenBuddies computer or over Tailscale.</p>", 403);
    }
    if (!existsSync(webRoot)) return c.html("<p>The web app is not built yet. Run <code>pnpm build</code>.</p>", 503);
    const file = normalize(join(webRoot, decodeURIComponent(path)));
    if (file.startsWith(webRoot) && existsSync(file) && statSync(file).isFile()) return sendFile(c, file);
    return sendFile(c, join(webRoot, "index.html"));
  });

  // ---- WebSocket for child devices ----
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  /** The apps a child has: the ones turned on for them, then what's coming. */
  const childApps = (childId: string): AppTile[] => {
    const child = household.children.get(childId);
    const on = [...household.apps.values()].filter((a) => child && appOn(child, a));
    // The built-in apps in their order (Chat, Picture Studio, Quizzes), then the rest by name.
    const rank = (id: string) => ["homework", "picture-studio", "quizzes"].indexOf(id) + 1 || 99;
    on.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
    return [...on.map((a) => ({ id: a.id, name: a.name, description: a.description, icon: a.icon, art: a.art, kind: a.kind, live: true })), ...COMING_SOON];
  };
  /** Whether a child may use an app. */
  const canUse = (childId: string, appId: unknown): appId is string => {
    const child = household.children.get(childId);
    const app = typeof appId === "string" ? household.apps.get(appId) : undefined;
    return !!child && !!app && appOn(child, app);
  };

  wss.on("connection", (ws: WebSocket) => {
    let device: { id: number; childId: string } | null = null;
    const send = (e: ServerEvent) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(e));
    const authTimer = setTimeout(() => !device && ws.close(4000, "auth timeout"), 5000);
    let alive = true;
    ws.on("pong", () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 30_000);

    ws.on("message", (data) => {
      let msg: ClientEvent;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === "auth") {
        const row = typeof msg.token === "string" ? db.deviceByToken(msg.token) : null;
        if (!row) {
          send({ type: "revoked" });
          return ws.close(4001, "unknown device");
        }
        clearTimeout(authTimer);
        device = { id: row.id, childId: row.child_id };
        db.touchDevice(row.id);
        if (!sockets.has(row.child_id)) sockets.set(row.child_id, new Set());
        sockets.get(row.child_id)!.add({ ws, deviceId: row.id });
        const child = household.children.get(row.child_id);
        send({
          type: "ready",
          child: { id: row.child_id, name: child?.profile.name ?? row.child_id, parentTitle: household.config.parent.title, subjects: subjectOptions(row.child_id) },
          buddies: db.listBuddies(row.child_id),
          activeBuddyId: db.activeBuddyId(row.child_id),
          apps: childApps(row.child_id),
        });
        send({ type: "schedules", schedules: scheduler.list(row.child_id) });
        send({ type: "nudges", nudges: db.unseenNudges(row.child_id) });
        return;
      }
      if (!device) return;
      // Revocation takes effect immediately, even mid-connection.
      const current = db.deviceById(device.id);
      if (!current || current.revoked_at) {
        send({ type: "revoked" });
        return ws.close(4001, "revoked");
      }
      const childId = device.childId;
      if (msg.type === "sync") {
        const buddyId = db.activeBuddyId(childId);
        const app = canUse(childId, msg.app) ? msg.app : "homework";
        // A device still showing another buddy's chat gets this one's from the start.
        const since = msg.buddyId === buddyId ? Number(msg.since) || 0 : 0;
        const { items, reset } = db.uiSync(childId, since, buddyId, app);
        send({ type: "items", items, reset, app });
        send({ type: "problem", problem: problemView(db.activeProblem(childId, buddyId)), app });
        const making = quizzes.making(childId, buddyId, app);
        send({ type: "quizzing", on: !!making, ...making, app });
        db.touchDevice(device.id);
      } else if (msg.type === "create_buddy" || msg.type === "update_buddy") {
        const buddy = validateBuddy(msg.buddy, household.children.get(childId)?.profile.subjects ?? []);
        if ("error" in buddy) return send({ type: "error", message: buddy.error });
        const before = db.activeBuddyId(childId);
        if (msg.type === "create_buddy") {
          try {
            db.createBuddy(childId, buddy);
          } catch (e) {
            return send({ type: "error", message: (e as Error).message });
          }
          log(`buddy made for ${childId}`);
        } else if (!db.updateBuddy(childId, Number(msg.id), buddy)) return;
        if (buddy.newSubject) addSubjectFor(childId, buddy.newSubject);
        buddiesChanged(childId, before);
      } else if (msg.type === "switch_buddy" || msg.type === "delete_buddy") {
        const before = db.activeBuddyId(childId);
        const ok = msg.type === "switch_buddy" ? db.switchBuddy(childId, Number(msg.id)) : removeBuddy(childId, Number(msg.id));
        // Leaving a buddy ends its sitting: time to update its notes.
        if (ok && msg.type === "switch_buddy" && before !== null && before !== Number(msg.id)) void memory.updateNow(childId, before);
        if (ok) buddiesChanged(childId, before);
      } else if (msg.type === "dress_buddy") {
        if (!isBuddyColor(msg.color)) return;
        if (db.dressBuddy(childId, Number(msg.id), msg.color, cleanWear(msg.wear))) buddiesChanged(childId, db.activeBuddyId(childId));
      } else if (msg.type === "make_quiz") {
        if (!quizzes.choose(childId, Number(msg.id), msg.style)) send({ type: "error", message: "That quiz is already being made." });
      } else if (msg.type === "seen_nudges") {
        if (db.seeNudges(childId, Number(msg.buddyId))) emit(childId, { type: "nudges", nudges: db.unseenNudges(childId) });
      } else if (msg.type === "add_schedule") {
        const buddyId = db.activeBuddyId(childId);
        if (buddyId === null) return;
        const res = scheduler.add(childId, buddyId, msg.schedule ?? {});
        if ("error" in res) send({ type: "error", message: res.error });
      } else if (msg.type === "schedule") {
        const actions = ["confirm", "cancel", "pause", "resume", "delete"] as const;
        if (!actions.includes(msg.action)) return;
        if (!scheduler.act(childId, Number(msg.id), msg.action)) send({ type: "error", message: "That reminder can't be changed now." });
      } else if (msg.type === "send") {
        const text = typeof msg.text === "string" ? msg.text.trim() : "";
        if (!text || !canUse(childId, msg.app)) return;
        const buddyId = db.activeBuddyId(childId);
        if (buddyId === null) return send({ type: "error", message: "Make your study buddy first." });
        db.touchDevice(device.id);
        const fileIds = Array.isArray(msg.files) ? msg.files.map(Number).filter(Number.isInteger) : [];
        pipeline.handleMessage(childId, msg.app, text, buddyId, fileIds).catch(() => {});
      }
    });
    ws.on("close", () => {
      clearTimeout(authTimer);
      clearInterval(ping);
      if (device) for (const s of sockets.get(device.childId) ?? []) if (s.ws === ws) sockets.get(device.childId)!.delete(s);
    });
  });

  const listener = getRequestListener(app.fetch);
  const servers: Server[] = [];
  const bound: string[] = [];
  const addrs = opts.loopbackOnly ? ["127.0.0.1"] : bindAddresses(household.config.bind);
  for (const addr of addrs) {
    const server = createServer(listener);
    server.on("upgrade", (req, socket, head) => {
      const fwd = req.headers["x-forwarded-for"];
      const ip = clientIp(req.socket.remoteAddress, Array.isArray(fwd) ? fwd[0] : fwd);
      if (!allowedClient(ip) || !req.url?.startsWith("/ws")) return socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    });
    const ok = await new Promise<boolean>((resolve) => {
      server.once("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "EADDRINUSE" && addr === "127.0.0.1") resolve(false);
        else {
          log(`could not bind ${addr}: ${e.code}`);
          resolve(false);
        }
      });
      server.listen(port, addr, () => resolve(true));
    });
    if (ok) {
      servers.push(server);
      bound.push(addr);
    }
    else if (addr === "127.0.0.1") {
      for (const s of servers) s.close();
      throw new Error(`Port ${port} is already in use. Is OpenBuddies already running?`);
    }
  }
  const actualPort = (servers[0].address() as { port: number }).port;
  log(`listening on ${bound.join(", ")} port ${actualPort}`);

  return {
    port: actualPort,
    household: () => household,
    db,
    memory,
    scheduler,
    heartbeat,
    async close() {
      stopWatching();
      stopMemory();
      stopScheduler();
      stopHeartbeat();
      for (const client of wss.clients) client.terminate();
      await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
      agent.dispose();
      db.close();
    },
  };
}
