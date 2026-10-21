// A buddy's reminders and plans: an alarm-clock dropdown at the top of the home screen, and a page to pause or delete
// them and to turn on notifications. Reminders belong to the buddy they were made with; new ones are made by asking
// that buddy in the chat.

import { useEffect, useRef, useState } from "react";
import { AlarmClockIcon, BellIcon, BellOffIcon, ChevronRightIcon, PauseIcon, PlayIcon, PlusIcon, Share2Icon, Trash2Icon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SCHEDULE_LIMITS, type Buddy, type ClientEvent, type Schedule } from "../../../src/shared/protocol";
import { usePush } from "./push";
import { TopBar } from "./TopBar";
import type { ScheduleAction } from "./useTutorSocket";

/** When it next goes off, the way a child says it: "Today 4:00pm", "Tomorrow 8:00am", "Fri 8:00am". */
export function fmtNext(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toDateString();
  if (d.toDateString() === day(0)) return `Today ${time}`;
  if (d.toDateString() === day(1)) return `Tomorrow ${time}`;
  if (d.getTime() - Date.now() < 6 * 86_400_000) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

const upcoming = (schedules: Schedule[]) => schedules.filter((s) => s.status === "active" && s.nextAt).sort((a, b) => Date.parse(a.nextAt!) - Date.parse(b.nextAt!));

/**
 * The alarm-clock button at the top of the home screen, next to the buddy picker: how many reminders this buddy has,
 * and a dropdown of them. Reminders belong to the buddy they were made with.
 */
export function ReminderBell({ schedules, buddy, onOpenAll }: { schedules: Schedule[]; buddy: Buddy; onOpenAll: (adding: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const mine = schedules.filter((s) => s.buddyId === buddy.id && (s.status === "active" || s.status === "paused"));
  const next = upcoming(mine);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${buddy.name}'s reminders (${next.length})`}
        className="relative flex size-11 items-center justify-center rounded-full border bg-card text-buddy-strong shadow-xs transition-transform active:scale-95"
      >
        <AlarmClockIcon className="size-5" />
        {next.length > 0 && (
          <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-buddy text-[11px] font-bold text-buddy-on ring-2 ring-background">{next.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute top-13 right-0 z-30 w-[min(20rem,calc(100vw-2.5rem))] animate-in rounded-3xl border bg-card p-3 shadow-xl fade-in slide-in-from-top-1 duration-150" role="dialog" aria-label={`${buddy.name}'s reminders`}>
          <p className="px-2 pt-1 pb-2 text-sm font-bold text-heading">{buddy.name}'s reminders</p>
          {next.length ? (
            <ul className="flex flex-col">
              {next.slice(0, 5).map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-2xl px-2 py-2">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-buddy-soft text-buddy-strong">
                    <AlarmClockIcon className="size-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-heading">{s.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{s.when}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-buddy-soft px-2 py-0.5 text-[11px] font-bold text-buddy-strong">{fmtNext(s.nextAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 pb-2 text-sm leading-snug text-muted-foreground">
              None yet. Ask {buddy.name} in the chat, like <span className="font-semibold text-foreground">"remind me tomorrow at 8 to pack my PE kit"</span>.
            </p>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              className="h-10 rounded-2xl bg-buddy font-semibold text-buddy-on hover:bg-buddy/90"
              onClick={() => {
                setOpen(false);
                onOpenAll(true);
              }}
            >
              <PlusIcon /> Add
            </Button>
            <Button
              variant="secondary"
              className="h-10 rounded-2xl font-semibold"
              onClick={() => {
                setOpen(false);
                onOpenAll(false);
              }}
            >
              {mine.length ? "Change" : "Settings"} <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Turning notifications on for this device, or why they can't be. */
function NotificationsPanel() {
  const { state, error, enable, disable } = usePush();
  if (state === "checking") return null;
  const box = "card-buddy flex items-start gap-3 rounded-3xl p-4";
  if (state === "on") {
    return (
      <div className={box}>
        <BellIcon className="mt-0.5 size-5 shrink-0 text-mint" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-heading">Reminders pop up on this device</p>
          <p className="text-sm text-muted-foreground">Even when OpenBuddies is closed.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={disable}>
          Turn off
        </Button>
      </div>
    );
  }
  if (state === "off") {
    return (
      <div className={box}>
        <BellIcon className="mt-0.5 size-5 shrink-0 text-buddy-strong" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-heading">Get reminders on this device</p>
          <p className="text-sm text-muted-foreground">They'll pop up even when OpenBuddies is closed.</p>
          {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
        </div>
        <Button size="sm" className="rounded-full bg-buddy text-buddy-on hover:bg-buddy/90" onClick={enable}>
          Turn on
        </Button>
      </div>
    );
  }
  const why: Record<string, { icon: typeof BellIcon; text: string }> = {
    "needs-install": { icon: Share2Icon, text: "To get reminders on this iPhone or iPad, add OpenBuddies to your Home Screen first: tap Share, then Add to Home Screen, and open it from there." },
    "needs-https": { icon: BellOffIcon, text: "Reminders show here and in your chat. Ask your grown-up about turning on Tailscale so they can pop up on this device too." },
    blocked: { icon: BellOffIcon, text: "Notifications are turned off for OpenBuddies in this browser's settings. Your reminders still show here and in your chat." },
    unsupported: { icon: BellOffIcon, text: "This browser can't show reminders as notifications, but they still show here and in your chat." },
  };
  const w = why[state];
  return (
    <div className={box}>
      <w.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{w.text}</p>
    </div>
  );
}

/** A buddy's reminders and plans, to pause, restart or delete, and notifications for this device. */
export function RemindersPage({
  schedules,
  buddy,
  onAct,
  onAdd,
  onBack,
  error,
  startAdding = false,
}: {
  schedules: Schedule[];
  buddy: Buddy;
  onAct: (id: number, action: ScheduleAction) => void;
  onAdd: (s: NewReminder) => void;
  onBack: () => void;
  /** The server's last error, e.g. a time that's gone. */
  error: string | null;
  startAdding?: boolean;
}) {
  const live = schedules.filter((s) => s.buddyId === buddy.id && (s.status === "active" || s.status === "paused")).sort((a, b) => Date.parse(a.nextAt ?? "9999") - Date.parse(b.nextAt ?? "9999"));
  const [adding, setAdding] = useState(startAdding);
  return (
    <main className="mx-auto min-h-dvh max-w-md pb-[max(20px,env(safe-area-inset-bottom))]">
      <TopBar title={`${buddy.name}'s reminders`} onBack={onBack} />
      <div className="flex flex-col gap-4 px-4 pt-2">
        {adding ? (
          <AddReminder buddy={buddy} count={live.length} error={error} onAdd={onAdd} onDone={() => setAdding(false)} />
        ) : (
          <Button className="h-12 rounded-2xl bg-buddy text-base font-semibold text-buddy-on hover:bg-buddy/90" onClick={() => setAdding(true)}>
            <PlusIcon /> Add a reminder
          </Button>
        )}
        <NotificationsPanel />
        {live.length === 0 ? (
          <p className="rounded-3xl border border-dashed px-5 py-8 text-center text-muted-foreground">
            No reminders yet. Ask {buddy.name} in the chat, like "remind me tomorrow at 8 to pack my PE kit".
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {live.map((s) => {
              const paused = s.status === "paused";
              return (
                <li key={s.id} className={cn("flex items-center gap-3 rounded-3xl border bg-card p-3", paused && "opacity-70")}>
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-buddy-soft text-buddy-strong">
                    <AlarmClockIcon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold text-heading">{s.label}</div>
                    <div className="text-sm text-muted-foreground">{s.when}</div>
                    <div className="text-xs font-semibold text-buddy-strong">{paused ? "Paused" : `Next: ${fmtNext(s.nextAt)}`}</div>
                  </div>
                  <Button variant="ghost" size="icon" className="rounded-full" onClick={() => onAct(s.id, paused ? "resume" : "pause")} aria-label={paused ? `Restart ${s.label}` : `Pause ${s.label}`}>
                    {paused ? <PlayIcon /> : <PauseIcon />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full text-muted-foreground hover:text-destructive"
                    onClick={() => confirm(`Delete "${s.label}"?`) && onAct(s.id, "delete")}
                    aria-label={`Delete ${s.label}`}
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}

export type NewReminder = Extract<ClientEvent, { type: "add_schedule" }>["schedule"];

const DAYS = [
  [1, "M", "Mon"],
  [2, "T", "Tue"],
  [3, "W", "Wed"],
  [4, "T", "Thu"],
  [5, "F", "Fri"],
  [6, "S", "Sat"],
  [0, "S", "Sun"],
] as const;

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Two big options side by side, one picked. */
function Choice<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cn("rounded-xl px-3 py-2 text-sm font-semibold transition-colors", value === v ? "bg-card text-heading shadow-xs" : "text-muted-foreground")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Setting up a reminder by hand: what it's for, and when. */
function AddReminder({ buddy, count, error, onAdd, onDone }: { buddy: Buddy; count: number; error: string | null; onAdd: (s: NewReminder) => void; onDone: () => void }) {
  const [kind, setKind] = useState<"reminder" | "task">("reminder");
  const [text, setText] = useState("");
  const [repeat, setRepeat] = useState<"once" | "weekly">("once");
  const [date, setDate] = useState(() => isoDay(new Date(Date.now() + 86_400_000)));
  const [time, setTime] = useState("08:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [sentAt, setSentAt] = useState<number | null>(null);
  // It's set up when the list grows; close then. If the server says no, its error shows instead.
  useEffect(() => {
    if (sentAt !== null && count > sentAt) onDone();
  }, [count, sentAt, onDone]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || (repeat === "weekly" && !days.length)) return;
    setSentAt(count);
    onAdd({ kind, text: text.trim(), rule: repeat === "once" ? { repeat, date, time } : { repeat, days: [...days].sort(), time } });
  };
  const label = "mb-1.5 block text-sm font-bold text-heading";
  return (
    <form onSubmit={submit} className="card-buddy flex flex-col gap-4 rounded-3xl p-4">
      <h2 className="text-lg">New reminder</h2>
      <Choice
        value={kind}
        onChange={setKind}
        options={[
          ["reminder", "Remind me"],
          ["task", `Do it with ${buddy.name}`],
        ]}
      />
      <div>
        <label className={label} htmlFor="reminder-text">
          {kind === "reminder" ? "What for?" : `What should ${buddy.name} do?`}
        </label>
        <Input
          id="reminder-text"
          value={text}
          maxLength={SCHEDULE_LIMITS.textLength}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === "reminder" ? "Pack my PE kit" : "Quiz me on my times tables"}
          className="h-12 rounded-2xl bg-card text-base"
          autoFocus
        />
      </div>
      <div>
        <span className={label}>When?</span>
        <Choice
          value={repeat}
          onChange={setRepeat}
          options={[
            ["once", "Once"],
            ["weekly", "Every week"],
          ]}
        />
        {repeat === "once" ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Input type="date" value={date} min={isoDay(new Date())} onChange={(e) => setDate(e.target.value)} className="h-12 rounded-2xl bg-card text-base" aria-label="Day" />
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-12 rounded-2xl bg-card text-base" aria-label="Time" />
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex justify-between gap-1">
              {DAYS.map(([d, short, long]) => {
                const on = days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDays((x) => (on ? x.filter((y) => y !== d) : [...x, d]))}
                    aria-pressed={on}
                    aria-label={long}
                    className={cn("flex size-10 items-center justify-center rounded-full text-sm font-bold transition-colors", on ? "bg-buddy text-buddy-on" : "bg-card text-muted-foreground")}
                  >
                    {short}
                  </button>
                );
              })}
            </div>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-12 rounded-2xl bg-card text-base" aria-label="Time" />
          </div>
        )}
      </div>
      {sentAt !== null && error && <p className="rounded-2xl bg-coral-soft px-3 py-2 text-sm text-coral">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="h-12 flex-1 rounded-2xl bg-buddy text-base font-semibold text-buddy-on hover:bg-buddy/90" disabled={!text.trim() || (repeat === "weekly" && !days.length)}>
          Set it
        </Button>
        <Button type="button" variant="ghost" className="h-12 rounded-2xl" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
