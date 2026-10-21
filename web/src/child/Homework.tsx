import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CircleCheckIcon, LightbulbIcon, PaperclipIcon, RotateCcwIcon, SendHorizontalIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BuddyFace } from "@/components/brand";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";
import { ChildMessage, isTutorSide, NoticePill, ReminderCard, SolvedMarker, TextBubble, TimeMarker, TutorItem, TutorMessage, Typing } from "@/chat/ChatParts";
import { FileThumb } from "@/chat/FileParts";
import type { AppTile, Buddy, BuddyFile, ChatItem, FileRef, SequencedItem } from "../../../src/shared/protocol";
import { AttachSheet } from "./BuddyFiles";
import { onVisibleResize } from "./keyboard";
import { PaintingCanvas } from "./PaintingCanvas";
import { QuizMaking } from "./QuizMaking";
import { TopBar } from "./TopBar";
import type { TutorState } from "./useTutorSocket";

const GAP_MS = 20 * 60_000;

type Row =
  | { kind: "child"; key: string; items: SequencedItem[] }
  | { kind: "tutor"; key: string; items: SequencedItem[] }
  | { kind: "solved"; key: string; label: string }
  | { kind: "notice"; key: string; text: string }
  | { kind: "reminder"; key: string; item: Extract<ChatItem, { kind: "reminder" }>; at: string }
  | { kind: "time"; key: string; at: string };

/** Consecutive items from the same side become one message, with time markers after long gaps. */
function toRows(items: SequencedItem[]): Row[] {
  const rows: Row[] = [];
  let prevAt = 0;
  for (const s of items) {
    const at = Date.parse(s.at);
    if (prevAt && at - prevAt > GAP_MS) rows.push({ kind: "time", key: `t${s.seq}`, at: s.at });
    prevAt = at;
    const last = rows.at(-1);
    if (s.item.kind === "solved") rows.push({ kind: "solved", key: `s${s.seq}`, label: s.item.label });
    else if (s.item.kind === "notice") rows.push({ kind: "notice", key: `n${s.seq}`, text: s.item.text });
    else if (s.item.kind === "reminder") rows.push({ kind: "reminder", key: `r${s.seq}`, item: s.item, at: s.at });
    else if (s.item.kind === "child") {
      if (last?.kind === "child") last.items.push(s);
      else rows.push({ kind: "child", key: `c${s.seq}`, items: [s] });
    } else if (isTutorSide(s.item)) {
      if (last?.kind === "tutor") last.items.push(s);
      else rows.push({ kind: "tutor", key: `m${s.seq}`, items: [s] });
    }
  }
  return rows;
}

interface QuickReply {
  label: string;
  /** Sent straight away, or put in the box to finish (prefill). */
  send?: string;
  prefill?: string;
}

function quickReplies(state: TutorState, justSolved: boolean, app: AppTile): QuickReply[] {
  if (state.conn !== "online" || state.thinking) return [];
  if (app.kind === "studio") {
    return [
      { label: "Surprise me!", send: "Surprise me with a picture!" },
      { label: "Give me an idea", send: "Can you give me an idea for a picture?" },
      { label: "Change it", prefill: "Can you change it so " },
    ];
  }
  // Other apps bring their own ways of working; the homework shortcuts would get in the way.
  if (app.id !== "homework") return [];
  if (justSolved) return [{ label: "Next question", prefill: "Next question: " }];
  if (state.problem) {
    return [
      { label: "I'm stuck", send: "I'm stuck" },
      { label: "Give me a hint", send: "Can I have a hint?" },
      { label: "Explain it another way", send: "Can you explain it another way?" },
      { label: "Check my answer", prefill: "Can you check my answer? I got  because " },
    ];
  }
  return [
    { label: "I'm stuck on…", prefill: "I'm stuck on: " },
    { label: "I don't understand…", prefill: "I don't understand " },
    { label: "Check my answer", prefill: "Can you check my answer? The question is  and I got " },
  ];
}

type HomeworkProps = {
  state: TutorState;
  buddy: Buddy;
  /** The app this chat is in: Homework, Picture Studio, or another app. */
  app: AppTile;

  send: (text: string, files: number[]) => boolean;
  onBack: () => void;
  onBuddyTap: () => void;
  /** Open this buddy's file vault. */
  onOpenFiles: () => void;
  /** Files to share with the first message (from "Ask about it" in the vault). */
  initialFiles?: number[];
  /** Text to start the message box with (from "Make a quiz"). */
  initialText?: string;
};

type Pending = { text: string; files?: FileRef[] };

export function Homework(props: HomeworkProps) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <HomeworkChat {...props} />
    </MessageScrollerProvider>
  );
}

function HomeworkChat({ state, buddy, app, send, onBack, onBuddyTap, onOpenFiles, initialFiles = [], initialText = "" }: HomeworkProps) {
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState<Pending[]>([]);
  // Files to share with the next message, and whether the paperclip sheet is open.
  const [attached, setAttached] = useState<number[]>(initialFiles);
  const [attaching, setAttaching] = useState(false);
  const files = state.files[buddy.id] ?? [];
  const attachedFiles = attached.map((id) => files.find((f) => f.id === id)).filter((f): f is BuddyFile => !!f && f.status !== "failed");
  const reading = attachedFiles.some((f) => f.status === "reading");
  const toggleFile = (id: number, on?: boolean) => setAttached((a) => ((on ?? !a.includes(id)) ? [...new Set([...a, id])] : a.filter((x) => x !== id)));
  const [lastSent, setLastSent] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const seenChild = useRef(0);

  // An optimistic bubble disappears when the server echoes the child's message back.
  const childCount = state.items.filter((s) => s.item.kind === "child").length;
  useEffect(() => {
    if (childCount > seenChild.current && pending.length) setPending((p) => p.slice(childCount - seenChild.current));
    seenChild.current = childCount;
  }, [childCount]);

  const rows = useMemo(() => toRows(state.items), [state.items]);
  const lastExampleSeq = useMemo(() => [...state.items].reverse().find((s) => s.item.kind === "worked_example")?.seq, [state.items]);
  const lastRow = rows.at(-1);
  const justSolved = lastRow?.kind === "solved" || (lastRow?.kind === "tutor" && rows.at(-2)?.kind === "solved");
  const replies = quickReplies(state, justSolved, app);

  // Sending while the buddy is thinking is fine: the server answers everything sent meanwhile in one reply.
  const canSend = state.conn === "online" && !reading;
  const mood = state.thinking ? "thinking" : justSolved ? "happy" : "idle";

  // Keep the newest message in view: the child's own as they send it, then the buddy's reply as it arrives.
  const { scrollToEnd } = useMessageScroller();
  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollToEnd({ behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [rows.length, pending.length, state.thinking, state.streaming, state.painting, state.quizzing, state.error, scrollToEnd]);
  // As the keyboard opens the chat gets shorter: keep the newest message in view above the message box.
  useEffect(() => onVisibleResize(() => scrollToEnd({ behavior: "auto" })), [scrollToEnd]);

  const submit = (value: string) => {
    const t = value.trim() || (attachedFiles.length ? "Can you look at this?" : "");
    if (!t || !canSend) return;
    const ids = attachedFiles.map((f) => f.id);
    if (send(t, ids)) {
      setPending((p) => [...p, { text: t, files: attachedFiles.map((f) => ({ id: f.id, name: f.name, kind: f.kind })) }]);
      setLastSent(t);
      setText("");
      setAttached([]);
    }
  };
  const prefill = (t: string) => {
    setText(t);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      const caret = t.includes("  ") ? t.indexOf("  ") + 1 : t.length;
      el.setSelectionRange(caret, caret);
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(text);
    }
  };

  // Sized to what the keyboard leaves visible, so the message box always sits just above it.
  return (
    <main className="fixed inset-x-0 top-(--app-top,0px) mx-auto flex h-(--app-height,100dvh) max-w-[720px] flex-col">
      <TopBar
        title={app.name}
        onBack={onBack}
        right={
          <button onClick={onBuddyTap} className="relative rounded-2xl transition-transform active:scale-90" aria-label={`Switch buddy (talking to ${buddy.name})`}>
            <BuddyFace key={buddy.id} color={buddy.color} wear={buddy.wear} mood={mood} className="size-11 animate-pop" title={buddy.name} star={buddy.main} />
            <span className={cn("absolute right-0.5 bottom-0.5 size-3 rounded-full border-2 border-background", state.conn === "online" ? "bg-mint" : "animate-pulse bg-sunny")} />
          </button>
        }
      />

      <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-4 px-3 py-4">
              {rows.length === 0 && pending.length === 0 && (
                <div className="mx-auto mt-10 flex max-w-xs flex-col items-center gap-3 text-center">
                  <BuddyFace color={buddy.color} wear={buddy.wear} className="size-20" title={buddy.name} star={buddy.main} />
                  {app.id === "homework" ? (
                    <>
                      <p className="text-lg font-semibold text-heading">What shall we talk about?</p>
                      <p className="text-sm text-muted-foreground">Ask {buddy.name} anything, or say what homework you're stuck on. You'll work it out together, step by step.</p>
                    </>
                  ) : app.kind === "studio" ? (
                    <>
                      <p className="text-lg font-semibold text-heading">What shall we make?</p>
                      <p className="text-sm text-muted-foreground">Ask {buddy.name} for a picture, like "a dragon building a sandcastle". Then ask for changes: "add a dog to it".</p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-semibold text-heading">{app.name}</p>
                      <p className="text-sm text-muted-foreground">{app.description} Say hi to {buddy.name} to start.</p>
                    </>
                  )}
                </div>
              )}
              {rows.map((row) => (
                <MessageScrollerItem key={row.key} messageId={row.key}>
                  {row.kind === "time" && <TimeMarker at={row.at} />}
                  {row.kind === "solved" && <SolvedMarker label={row.label} />}
                  {row.kind === "notice" && <NoticePill text={row.text} />}
                  {row.kind === "reminder" && <ReminderCard item={row.item} at={row.at} />}
                  {row.kind === "child" && <ChildMessage messages={row.items.map((s) => s.item as Extract<ChatItem, { kind: "child" }>)} />}
                  {row.kind === "tutor" && (
                    <TutorMessage color={buddy.color} wear={buddy.wear} name={buddy.name}>
                      {row.items.map((s) => (
                        <TutorItem key={s.seq} item={s.item} stepwise={s.seq === lastExampleSeq} />
                      ))}
                    </TutorMessage>
                  )}
                </MessageScrollerItem>
              ))}

              {pending.map((p, i) => (
                <MessageScrollerItem key={`p${i}`} messageId={`p${i}`}>
                  <ChildMessage messages={[p]} pending />
                </MessageScrollerItem>
              ))}

              {state.painting && (
                <MessageScrollerItem messageId="painting">
                  <TutorMessage color={buddy.color} wear={buddy.wear} mood="happy" name={buddy.name}>
                    <PaintingCanvas buddy={buddy} title={state.painting} />
                  </TutorMessage>
                </MessageScrollerItem>
              )}
              {state.quizzing && (
                <MessageScrollerItem messageId="quizzing">
                  <TutorMessage color={buddy.color} wear={buddy.wear} mood="happy" name={buddy.name}>
                    <QuizMaking buddy={buddy} topic={state.quizzing.topic} count={state.quizzing.count} />
                  </TutorMessage>
                </MessageScrollerItem>
              )}
              {!state.painting && !state.quizzing && (state.thinking || state.streaming) && (
                <MessageScrollerItem messageId="live">
                  <TutorMessage color={buddy.color} wear={buddy.wear} mood="thinking" name={buddy.name}>
                    {state.streaming ? (
                      <TextBubble>
                        {state.streaming}
                        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-buddy align-middle" />
                      </TextBubble>
                    ) : (
                      <Typing label={`${buddy.name} is thinking`} />
                    )}
                  </TutorMessage>
                </MessageScrollerItem>
              )}

              {state.error && !state.thinking && (
                <MessageScrollerItem messageId="error">
                  <Bubble variant="destructive" className="mx-auto">
                    <BubbleContent className="flex items-center gap-3 rounded-2xl px-4 py-2.5">
                      <span className="text-sm">{state.error}</span>
                      {lastSent && (
                        <Button size="sm" variant="outline" className="rounded-full" onClick={() => submit(lastSent)}>
                          <RotateCcwIcon /> Try again
                        </Button>
                      )}
                    </BubbleContent>
                  </Bubble>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="rounded-full shadow-sm" />
        </MessageScroller>

      <form
        className="px-3 pt-2 pb-[max(10px,env(safe-area-inset-bottom))] keyboard:pb-2.5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          submit(text);
        }}
      >

        {replies.length > 0 && (
          <div className="-mx-3 mb-2 flex gap-2 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none]">
            {replies.map((r) => (
              <Button
                key={r.label}
                type="button"
                variant="secondary"
                size="sm"
                className="h-9 shrink-0 rounded-full bg-buddy-soft px-3.5 font-semibold text-foreground hover:bg-buddy-soft/70"
                onClick={() => (r.send ? submit(r.send) : prefill(r.prefill ?? ""))}
              >
                {r.label === "Give me a hint" && <LightbulbIcon />}
                {r.label.startsWith("Check my answer") && <CircleCheckIcon />}
                {r.label}
              </Button>
            ))}
          </div>
        )}
        {attachedFiles.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-0.5">
            {attachedFiles.map((f) => (
              <span key={f.id} className="relative shrink-0">
                <FileThumb file={f} className="size-16 border" />
                <button
                  type="button"
                  onClick={() => toggleFile(f.id, false)}
                  className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-foreground text-background"
                  aria-label={`Don't share ${f.name}`}
                >
                  <XIcon className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <Button type="button" variant="ghost" size="icon-lg" className="size-12 shrink-0 rounded-full" onClick={() => setAttaching(true)} aria-label={`Show ${buddy.name} a photo or file`}>
            <PaperclipIcon className="size-5" />
          </Button>
          <InputGroup className="flex-1 rounded-3xl bg-card has-[[data-slot=input-group-control]:focus-visible]:ring-primary/30">
            <InputGroupTextarea
              ref={input}
              value={text}
              rows={1}
              maxLength={2000}
              placeholder={state.conn === "online" ? `Message ${buddy.name}…` : "Reconnecting…"}
              className="max-h-36 min-h-12 px-5 py-3 text-base"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </InputGroup>
          <Button type="submit" size="icon-lg" className="size-12 shrink-0 rounded-full bg-buddy text-buddy-on hover:bg-buddy/90" disabled={(!text.trim() && !attachedFiles.length) || !canSend} aria-label="Send">
            <SendHorizontalIcon className="size-5" />
          </Button>
        </div>
      </form>
      {attaching && <AttachSheet buddy={buddy} files={files} selected={attached} onToggle={toggleFile} onClose={() => setAttaching(false)} onManage={onOpenFiles} />}
    </main>
  );
}
