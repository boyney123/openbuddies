// Chat rendering shared by the child's Homework chat and the parent's session view, so the parent sees exactly
// what the child saw.

import { createContext, useContext, useState, type ReactNode } from "react";
import { AlarmClockIcon, BellRingIcon, CalendarCheckIcon, ChevronDownIcon, ExternalLinkIcon, FileSearchIcon, GlobeIcon, HandIcon, KeyboardIcon, ListChecksIcon, TrophyIcon, CheckCircle2Icon, CircleHelpIcon, LightbulbIcon, PartyPopperIcon, SparklesIcon, StarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BuddyFace, type BuddyMood } from "@/components/brand";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import type { Accessory, BuddyColor, ChatItem, FileRef, QuizStyle, Schedule } from "../../../src/shared/protocol";
import { FileThumb, MessageFiles } from "./FileParts";

export function BuddyAvatar({ color, wear, mood = "idle", name }: { color?: BuddyColor; wear?: readonly Accessory[]; mood?: BuddyMood; name?: string }) {
  return (
    <MessageAvatar className="size-9 min-w-9 bg-transparent">
      <BuddyFace color={color} wear={wear} mood={mood} className="size-9" title={name} />
    </MessageAvatar>
  );
}

/** One or more messages from the child, each with any files they shared. */
export function ChildMessage({ messages, pending, footer }: { messages: { text: string; files?: FileRef[] }[]; pending?: boolean; footer?: ReactNode }) {
  return (
    <Message align="end">
      <MessageContent className="gap-1.5">
        {messages.map((m, i) => (
          <div key={i} className={cn("flex flex-col items-end gap-1.5", pending && "opacity-60")}>
            {m.files?.length ? <MessageFiles files={m.files} /> : null}
            <Bubble align="end">
              <BubbleContent className="rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] whitespace-pre-wrap">{m.text}</BubbleContent>
            </Bubble>
          </div>
        ))}
        {footer}
      </MessageContent>
    </Message>
  );
}

export function TutorMessage({ color, wear, mood, name, children }: { color?: BuddyColor; wear?: readonly Accessory[]; mood?: BuddyMood; name?: string; children: ReactNode }) {
  return (
    <Message>
      <BuddyAvatar color={color} wear={wear} mood={mood} name={name} />
      <MessageContent className="gap-2 whitespace-pre-wrap">{children}</MessageContent>
    </Message>
  );
}

export function TextBubble({ text, children }: { text?: string; children?: ReactNode }) {
  return (
    <Bubble variant="outline" className="max-w-[88%]">
      <BubbleContent className="rounded-2xl rounded-bl-md border-transparent bg-muted px-4 py-2.5 text-[15px] text-foreground">{children ?? text}</BubbleContent>
    </Bubble>
  );
}

function HintBubble({ text }: { text: string }) {
  return (
    <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-buddy-soft px-4 py-2.5 text-[15px]">
      <span className="mb-0.5 flex items-center gap-1 text-xs font-bold text-buddy brightness-90 dark:brightness-125">
        <SparklesIcon className="size-3.5" /> Hint
      </span>
      {text}
    </div>
  );
}

/** Steps appear one at a time when `stepwise`, so the child can guess each one before seeing it. */
export function WorkedExample({ problem, steps, stepwise }: { problem: string; steps: string[]; stepwise: boolean }) {
  const [shown, setShown] = useState(stepwise ? 1 : steps.length);
  const done = shown >= steps.length;
  return (
    <div className="flex w-full max-w-[92%] gap-3 rounded-2xl bg-blue-soft p-4 text-foreground">
      <LightbulbIcon className="mt-0.5 size-6 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-primary dark:text-foreground">Worked example (similar question)</div>
        <div className="mt-1 text-base font-bold text-heading">{problem}</div>
        <ol className="mt-3 flex flex-col gap-2.5">
          {steps.slice(0, shown).map((s, i) => (
            <li key={i} className="flex animate-in gap-2.5 fade-in slide-in-from-bottom-1 text-[15px] leading-snug">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
        {done ? (
          <p className="mt-3 text-sm font-semibold text-primary dark:text-foreground">Now try the same steps on yours!</p>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" className="rounded-full" onClick={() => setShown((n) => n + 1)}>
              Next step
            </Button>
            <span className="text-xs text-muted-foreground">Can you guess it first?</span>
          </div>
        )}
      </div>
    </div>
  );
}

function CheckCard({ answer, correct, feedback }: { answer: string; correct: boolean; feedback: string }) {
  return (
    <div className={cn("w-full max-w-[88%] rounded-2xl p-4", correct ? "bg-mint-soft" : "bg-sunny-soft")}>
      <div className="flex items-center gap-1.5 font-bold text-heading">
        {correct ? (
          <>
            <CheckCircle2Icon className="size-4.5 text-mint" /> That's right!
          </>
        ) : (
          <>
            <CircleHelpIcon className="size-4.5 text-[#b57600] dark:text-sunny" /> Not quite yet
          </>
        )}
      </div>
      <div className="mt-0.5 text-sm text-muted-foreground">Your answer: {answer}</div>
      <div className="mt-1.5 text-[15px]">{feedback}</div>
    </div>
  );
}

/**
 * The child's reminders, so an offer card knows whether it's been set, and what to do when they tap. The parent's view
 * leaves it empty: the cards are shown, read-only.
 */
export const ScheduleContext = createContext<{ schedules: Schedule[] | null; act?: (id: number, action: "confirm" | "cancel") => void }>({ schedules: null });

/** The buddy offering to set up a reminder or plan: tap to set it. */
function ScheduleOffer({ item }: { item: Extract<ChatItem, { kind: "schedule" }> }) {
  const { schedules, act } = useContext(ScheduleContext);
  const s = schedules?.find((x) => x.id === item.scheduleId);
  const status = schedules === null ? "offered" : (s?.status ?? "gone");
  return (
    <div className="w-full max-w-[88%] rounded-2xl border-2 border-buddy/30 bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-buddy-soft text-buddy-strong">
          <AlarmClockIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{item.task ? "Plan" : "Reminder"}</div>
          <div className="text-base font-bold text-heading">{item.label}</div>
          <div className="text-sm text-muted-foreground">{item.when}</div>
        </div>
      </div>
      {status === "proposed" && act ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="rounded-full bg-buddy px-4 text-buddy-on hover:bg-buddy/90" onClick={() => act(item.scheduleId, "confirm")}>
            Set it
          </Button>
          <Button size="sm" variant="ghost" className="rounded-full" onClick={() => act(item.scheduleId, "cancel")}>
            No thanks
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          {status === "active" && (
            <>
              <CalendarCheckIcon className="size-4 text-mint" /> All set
            </>
          )}
          {status === "paused" && "Paused"}
          {status === "proposed" && "Waiting for a tap"}
          {status === "offered" && "Offered"}
          {status === "gone" && "Not set"}
        </div>
      )}
    </div>
  );
}

/**
 * What the child's app can do with quiz cards: pick the style of an offered quiz, open a ready one. The parent's view
 * leaves it empty: the cards are shown, read-only.
 */
export const QuizContext = createContext<{ choose?: (id: number, style: QuizStyle) => void; open?: (id: number) => void }>({});

/** The buddy offering a quiz: multiple choice, or typed answers? */
function QuizOffer({ item }: { item: Extract<ChatItem, { kind: "quiz_offer" }> }) {
  const { choose } = useContext(QuizContext);
  const [picked, setPicked] = useState<QuizStyle | null>(null);
  const pick = (style: QuizStyle) => {
    setPicked(style);
    choose?.(item.quizId, style);
  };
  return (
    <div className="w-full max-w-[88%] rounded-2xl border-2 border-buddy/30 bg-card p-4">
      <div className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Quiz</div>
      <div className="text-base font-bold text-heading capitalize">{item.topic}</div>
      {choose && !picked ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button size="sm" className="h-10 rounded-xl bg-buddy text-buddy-on hover:bg-buddy/90" onClick={() => pick("multiple_choice")}>
            <ListChecksIcon /> Multiple choice
          </Button>
          <Button size="sm" variant="secondary" className="h-10 rounded-xl" onClick={() => pick("single_answer")}>
            <KeyboardIcon /> Type answers
          </Button>
        </div>
      ) : (
        <div className="mt-1 text-sm text-muted-foreground">{picked ? (picked === "multiple_choice" ? "Multiple choice" : "Typed answers") : "Offered"}</div>
      )}
    </div>
  );
}

/** A quiz the buddy made: tap to take it. */
function QuizCard({ item }: { item: Extract<ChatItem, { kind: "quiz" }> }) {
  const { open } = useContext(QuizContext);
  return (
    <div className="flex w-full max-w-[88%] items-center gap-3 rounded-2xl bg-buddy-soft p-3">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-buddy text-buddy-on">
        <ListChecksIcon className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold text-heading">{item.title}</div>
        <div className="text-xs text-muted-foreground">
          {item.count} questions · {item.style === "multiple_choice" ? "multiple choice" : "type the answers"}
        </div>
      </div>
      {open && (
        <Button size="sm" className="shrink-0 rounded-full bg-buddy px-4 text-buddy-on hover:bg-buddy/90" onClick={() => open(item.quizId)}>
          Take it
        </Button>
      )}
    </div>
  );
}

/** How a quiz went. */
function QuizResult({ item }: { item: Extract<ChatItem, { kind: "quiz_result" }> }) {
  const great = item.score === item.total;
  return (
    <div className="flex w-full max-w-[88%] items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
      <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl text-lg font-extrabold", great ? "bg-mint-soft text-mint" : "bg-buddy-soft text-buddy-strong")}>
        {item.score}/{item.total}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Quiz result</div>
        <div className="truncate font-bold text-heading">{item.title}</div>
      </div>
      {great && <TrophyIcon className="size-6 shrink-0 text-sunny" />}
    </div>
  );
}

/** A reminder or plan going off, in the middle of the chat. */
export function ReminderCard({ item, at }: { item: Extract<ChatItem, { kind: "reminder" }>; at?: string }) {
  return (
    <div className="mx-auto flex w-full max-w-sm animate-pop items-start gap-3 rounded-2xl bg-buddy-soft p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-buddy text-buddy-on">
        <BellRingIcon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold tracking-wide text-buddy-strong uppercase">
          {item.task ? "Your plan" : "Reminder"}
          {at && ` · ${new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}
        </div>
        <div className="text-base font-bold text-heading">{item.label}</div>
        {!item.task && item.text !== item.label && <div className="mt-0.5 text-[15px]">{item.text}</div>}
      </div>
    </div>
  );
}

/** The files the buddy found from what the child said: a short line above its reply, tap to see them. */
export function FilesUsed({ files }: { files: FileRef[] }) {
  const [open, setOpen] = useState(false);
  const what = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "") : `${files.length} files`;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex max-w-full items-center gap-1.5 self-start rounded-full bg-buddy-soft px-2.5 py-1 text-xs font-semibold text-buddy-strong"
      >
        <FileSearchIcon className="size-3.5 shrink-0" />
        <span className="truncate">Looked at {what}</span>
        <ChevronDownIcon className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && <MessageFiles files={files} align="start" />}
    </div>
  );
}

const SITE_NAMES: Record<string, string> = {
  "bbc.co.uk": "BBC",
  "bbc.com": "BBC",
  "britannica.com": "Britannica",
  "wikipedia.org": "Wikipedia",
  "nasa.gov": "NASA",
  "natgeokids.com": "Nat Geo Kids",
  "thenational.academy": "Oak National Academy",
  "khanacademy.org": "Khan Academy",
  "metoffice.gov.uk": "Met Office",
};

/** A site's friendly name: "BBC Bitesize" for bbc.co.uk/bitesize, "Wikipedia" for en.wikipedia.org. */
function siteName(site: string, url: string): string {
  if (/bbc\.co\.uk\/bitesize/.test(url)) return "BBC Bitesize";
  const known = Object.keys(SITE_NAMES).find((d) => site === d || site.endsWith(`.${d}`));
  return known ? SITE_NAMES[known] : site;
}

/** A picture made in Picture Studio, big, with its title. It's kept in the buddy's files. */
function PictureCard({ file, title }: { file: FileRef; title: string }) {
  return (
    <figure className="w-full max-w-[88%] animate-pop overflow-hidden rounded-3xl border bg-card">
      <FileThumb file={file} className="aspect-square w-full rounded-none" />
      <figcaption className="flex items-center gap-1.5 px-4 py-3">
        <SparklesIcon className="size-4 shrink-0 text-buddy-strong" />
        <span className="min-w-0 flex-1 truncate font-bold text-heading">{title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">Saved in My files</span>
      </figcaption>
    </figure>
  );
}

/** Where the buddy looked something up, as links the child can open. */
export function LookedUp({ sources }: { sources: { title: string; site: string; url: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="flex items-center gap-1 font-semibold text-muted-foreground">
        <GlobeIcon className="size-3.5" /> Looked it up on
      </span>
      {sources.map((s) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          title={s.title}
          className="flex items-center gap-1 rounded-full bg-buddy-soft px-2.5 py-1 font-semibold text-buddy-strong hover:underline"
        >
          {siteName(s.site, s.url)} <ExternalLinkIcon className="size-3" />
        </a>
      ))}
    </div>
  );
}

/** One tutor-side item (reply text, hint, worked example, answer check, reminder offer, files or a web lookup). */
export function TutorItem({ item, stepwise = false }: { item: ChatItem; stepwise?: boolean }) {
  switch (item.kind) {
    case "tutor":
      return <TextBubble text={item.text} />;
    case "hint":
      return <HintBubble text={item.text} />;
    case "worked_example":
      return <WorkedExample problem={item.problem} steps={item.steps} stepwise={stepwise} />;
    case "check":
      return <CheckCard answer={item.answer} correct={item.correct} feedback={item.feedback} />;
    case "schedule":
      return <ScheduleOffer item={item} />;
    case "files_used":
      return <FilesUsed files={item.files} />;
    case "looked_up":
      return <LookedUp sources={item.sources} />;
    case "picture":
      return <PictureCard file={item.file} title={item.title} />;
    case "quiz_offer":
      return <QuizOffer item={item} />;
    case "quiz":
      return <QuizCard item={item} />;
    case "quiz_result":
      return <QuizResult item={item} />;
    case "checkin":
      return (
        <div className="flex max-w-[88%] flex-col gap-1">
          <span className="flex items-center gap-1 text-xs font-semibold text-buddy-strong">
            <HandIcon className="size-3.5" /> Checking in
          </span>
          <TextBubble text={item.text} />
        </div>
      );
    default:
      return null;
  }
}

export function Typing({ label = "Thinking" }: { label?: string }) {
  return (
    <TextBubble>
      <span className="flex gap-1.5 py-1" aria-label={label}>
        {[0, 150, 300].map((d) => (
          <span key={d} className="size-2 animate-bounce rounded-full bg-buddy/70" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
    </TextBubble>
  );
}

export function SolvedMarker({ label }: { label: string }) {
  return (
    <div className="flex animate-pop flex-col items-center gap-1 py-2 text-center">
      <div className="flex items-end gap-3" aria-hidden>
        <PartyPopperIcon className="size-7 -rotate-12 text-coral" />
        <StarIcon className="size-9 fill-sunny text-sunny" />
        <SparklesIcon className="size-7 rotate-12 text-tutor-blue" />
      </div>
      <div className="text-xl font-extrabold text-coral">You solved it!</div>
      <Marker variant="separator" className="text-xs">
        <MarkerContent>{label}</MarkerContent>
      </Marker>
    </div>
  );
}

export function NoticePill({ text }: { text: string }) {
  return <div className="mx-auto max-w-[85%] rounded-xl bg-sunny-soft px-3.5 py-2 text-center text-sm">{text}</div>;
}

export function TimeMarker({ at }: { at: string }) {
  return (
    <Marker variant="separator" className="text-xs">
      <MarkerContent>{new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</MarkerContent>
    </Marker>
  );
}

export const isTutorSide = (i: ChatItem) =>
  i.kind === "tutor" || i.kind === "hint" || i.kind === "worked_example" || i.kind === "check" || i.kind === "schedule" || i.kind === "files_used" || i.kind === "looked_up" || i.kind === "picture" || i.kind === "checkin" || i.kind === "quiz_offer" || i.kind === "quiz" || i.kind === "quiz_result";
