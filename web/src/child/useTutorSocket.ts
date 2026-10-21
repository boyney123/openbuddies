import { useCallback, useEffect, useRef, useState } from "react";
import type { Accessory, AppTile, Buddy, BuddyColor, BuddyFile, BuddyInput, ClientEvent, Nudge, ProblemView, QuizStyle, Schedule, SequencedItem, ServerEvent, SubjectOption } from "../../../src/shared/protocol";

export type ScheduleAction = Extract<ClientEvent, { type: "schedule" }>["action"];
import { listFiles } from "./files";

export const TOKEN_KEY = "openbuddies.deviceToken";

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export type ConnState = "connecting" | "online" | "offline" | "revoked";

export interface TutorState {
  conn: ConnState;
  child: { id: string; name: string; parentTitle: string; subjects: SubjectOption[] } | null;
  /** All the child's buddies, main first. Empty until they've made one. */
  buddies: Buddy[];
  /** The buddy they're talking to, or null until they've made one. The chat (items) is with this buddy. */
  buddy: Buddy | null;
  /** Each buddy's files, by buddy id, once loaded. */
  files: Record<number, BuddyFile[]>;
  /** Reminders and plans: proposed, active or paused. */
  schedules: Schedule[];
  /** What buddies said on their own that the child hasn't seen yet, newest first. */
  nudges: Nudge[];
  /** Bumped when a buddy's quizzes change, so its list is fetched again. */
  quizzesVersion: Record<number, number>;
  apps: AppTile[];
  items: SequencedItem[];
  problem: ProblemView | null;
  thinking: boolean;
  /** Text arriving for the reply currently being streamed. */
  streaming: string;
  /** Picture Studio: the title of the picture the buddy is painting right now, or null. */
  painting: string | null;
  /** The quiz the buddy is writing in this chat right now, or null. */
  quizzing: { topic: string; count: number } | null;
  error: string | null;
}

/** One socket per device. Replays missed items on reconnect so phone and laptop stay in step. */
export function useTutorSocket(token: string | null) {
  const [state, setState] = useState<TutorState>({ conn: "connecting", child: null, buddies: [], buddy: null, files: {}, schedules: [], nudges: [], quizzesVersion: {}, apps: [], items: [], problem: null, thinking: false, streaming: "", painting: null, quizzing: null, error: null });
  const ws = useRef<WebSocket | null>(null);
  const lastSeq = useRef(0);
  /** The buddy whose chat this device is showing. */
  const shownBuddy = useRef<number | null>(null);
  /** The app whose chat this device is showing. Chat events for other apps are left out. */
  const shownApp = useRef("homework");
  const retry = useRef(0);

  useEffect(() => {
    if (!token) return;
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const sock = new WebSocket(`${proto}://${location.host}/ws`);
      ws.current = sock;
      const send = (e: ClientEvent) => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify(e));
      sock.onopen = () => send({ type: "auth", token });
      sock.onmessage = (msg) => {
        const e: ServerEvent = JSON.parse(msg.data);
        if ("app" in e && e.app && e.app !== shownApp.current) return;
        switch (e.type) {
          case "ready":
          case "buddies": {
            const buddy = e.buddies.find((b) => b.id === e.activeBuddyId) ?? null;
            // Switching buddy switches chat: the server sends the new buddy's items next.
            const switched = buddy?.id !== shownBuddy.current;
            if (e.type === "ready") {
              retry.current = 0;
              setState((s) => ({ ...s, conn: "online", child: e.child, apps: e.apps, buddies: e.buddies, buddy, error: null }));
              send({ type: "sync", since: lastSeq.current, buddyId: shownBuddy.current, app: shownApp.current });
            } else {
              setState((s) => ({
                ...s,
                child: s.child && { ...s.child, subjects: e.subjects },
                buddies: e.buddies,
                buddy,
                error: null,
                ...(switched ? { thinking: false, streaming: "" } : {}),
              }));
            }
            shownBuddy.current = buddy?.id ?? null;
            // Switching buddy switches chat: ask for the new buddy's chat in the app being shown.
            if (e.type === "buddies" && switched) {
              lastSeq.current = 0;
              send({ type: "sync", since: 0, buddyId: shownBuddy.current, app: shownApp.current });
            }
            // The active buddy's files, for the chat's paperclip.
            if (buddy) listFiles(buddy.id).then((files) => setState((s) => ({ ...s, files: { ...s.files, [buddy.id]: files } })), () => {});
            break;
          }
          case "files":
            setState((s) => ({ ...s, files: { ...s.files, [e.buddyId]: e.files } }));
            break;
          case "schedules":
            setState((s) => ({ ...s, schedules: e.schedules }));
            break;
          case "quizzes":
            setState((s) => ({ ...s, quizzesVersion: { ...s.quizzesVersion, [e.buddyId]: (s.quizzesVersion[e.buddyId] ?? 0) + 1 } }));
            break;
          case "nudges":
            setState((s) => ({ ...s, nudges: e.nudges }));
            break;
          case "apps":
            setState((s) => ({ ...s, apps: e.apps }));
            break;
          case "items":
            setState((s) => {
              const base = e.reset ? [] : s.items;
              const known = new Set(base.map((i) => i.seq));
              const items = [...base, ...e.items.filter((i) => !known.has(i.seq))].sort((a, b) => a.seq - b.seq);
              lastSeq.current = items.at(-1)?.seq ?? (e.reset ? 0 : lastSeq.current);
              const tutorArrived = e.items.some((i) => i.item.kind === "tutor" || i.item.kind === "notice");
              return { ...s, items, streaming: tutorArrived ? "" : s.streaming };
            });
            break;
          case "problem":
            setState((s) => ({ ...s, problem: e.problem }));
            break;
          case "painting":
            setState((s) => ({ ...s, painting: e.on ? (e.title ?? "your picture") : null }));
            break;
          case "quizzing":
            setState((s) => ({ ...s, quizzing: e.on ? { topic: e.topic ?? "your quiz", count: e.count ?? 5 } : null }));
            break;
          case "thinking":
            setState((s) => ({ ...s, thinking: e.on, streaming: e.on ? "" : s.streaming }));
            break;
          case "reply_delta":
            setState((s) => ({ ...s, streaming: s.streaming + e.text }));
            break;
          case "reply_end":
            break;
          case "error":
            setState((s) => ({ ...s, error: e.message, streaming: "" }));
            break;
          case "revoked":
            closed = true;
            clearToken();
            setState((s) => ({ ...s, conn: "revoked" }));
            break;
        }
      };
      sock.onclose = (ev) => {
        if (closed || ev.code === 4001) {
          if (ev.code === 4001) {
            clearToken();
            setState((s) => ({ ...s, conn: "revoked" }));
          }
          return;
        }
        setState((s) => ({ ...s, conn: "offline", thinking: false }));
        const delay = Math.min(15000, 500 * 2 ** retry.current++);
        timer = setTimeout(connect, delay);
      };
    };
    connect();

    // Phones suspend sockets in the background; reconnect as soon as the app is visible again.
    const onVisible = () => {
      if (document.visibilityState === "visible" && ws.current?.readyState !== WebSocket.OPEN && !closed) {
        clearTimeout(timer);
        retry.current = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      ws.current?.close();
    };
  }, [token]);

  const send = useCallback((app: string, text: string, files: number[] = []) => {
    const sock = ws.current;
    if (!sock || sock.readyState !== WebSocket.OPEN) return false;
    sock.send(JSON.stringify({ type: "send", app, text, ...(files.length ? { files } : {}) } satisfies ClientEvent));
    setState((s) => ({ ...s, error: null }));
    return true;
  }, []);

  const command = useCallback((e: ClientEvent) => {
    const sock = ws.current;
    if (!sock || sock.readyState !== WebSocket.OPEN) return false;
    sock.send(JSON.stringify(e));
    return true;
  }, []);

  /** Load a buddy's files (the active buddy's load by themselves). */
  const loadFiles = useCallback((buddyId: number) => {
    listFiles(buddyId).then((files) => setState((s) => ({ ...s, files: { ...s.files, [buddyId]: files } })), () => {});
  }, []);

  const buddies = {
    create: (buddy: BuddyInput) => command({ type: "create_buddy", buddy }),
    update: (id: number, buddy: BuddyInput) => command({ type: "update_buddy", id, buddy }),
    switchTo: (id: number) => command({ type: "switch_buddy", id }),
    remove: (id: number) => command({ type: "delete_buddy", id }),
    dress: (id: number, look: { color: BuddyColor; wear: Accessory[] }) => command({ type: "dress_buddy", id, ...look }),
  };

  /** Confirm or turn down a proposed reminder, or pause, resume or delete one. */
  const schedule = useCallback((id: number, action: ScheduleAction) => command({ type: "schedule", id, action }), [command]);

  /** A reminder the child sets up themselves, for their current buddy. */
  const addSchedule = useCallback((s: Extract<ClientEvent, { type: "add_schedule" }>["schedule"]) => command({ type: "add_schedule", schedule: s }), [command]);

  /** Show an app's chat: its items replace the current ones. */
  const openApp = useCallback((app: string) => {
    if (app === shownApp.current) return;
    shownApp.current = app;
    lastSeq.current = 0;
    setState((s) => ({ ...s, items: [], problem: null, thinking: false, streaming: "", painting: null, quizzing: null }));
    command({ type: "sync", since: 0, buddyId: shownBuddy.current, app });
  }, [command]);

  /** The child has seen what a buddy said on its own. */
  const seeNudges = useCallback((buddyId: number) => command({ type: "seen_nudges", buddyId }), [command]);

  /** The child picked the kind of quiz the buddy offered to make. */
  const makeQuiz = useCallback((id: number, style: QuizStyle) => command({ type: "make_quiz", id, style }), [command]);

  return { state, send, buddies, loadFiles, schedule, addSchedule, openApp, seeNudges, makeQuiz };
}
