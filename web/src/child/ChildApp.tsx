import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GlobeIcon,
  GraduationCapIcon,
  HouseIcon,
  MessageCircleIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  SmileIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AppIcon } from "@/components/app-icon";
import { BooksArt, BuddyFace, buddyVars, ChartArt, ChatArt, QuizArt, EaselArt, FolderArt, LogoMark, NotebookArt, QuestionArt, ShieldArt, useBuddyTheme, Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import type { AppTile, Buddy, BuddyInput } from "../../../src/shared/protocol";
import { BuddyEditor, BuddyList, BuddySheet, subjectName } from "./Buddies";
import { BuddyMaker } from "./BuddyMaker";
import { ReminderBell, RemindersPage } from "./Reminders";
import { BuddyStage } from "./BuddyStage";
import { FileVault } from "./FileVault";
import { QuizContext, ScheduleContext } from "@/chat/ChatParts";
import { QuizPlayer, QuizzesPage } from "./Quizzes";
import { HatchSplash } from "./Hatch";
import { unlockAudio } from "./sounds";
import { Homework } from "./Homework";
import { useInstall } from "./install";
import { TopBar } from "./TopBar";
import { Wardrobe } from "./Wardrobe";
import { readToken, useTutorSocket } from "./useTutorSocket";

/** Screens live in the URL hash so the phone's back button works. `buddy-3` edits buddy 3; `app-homework` is an app's chat. */
type Screen = "home" | "about" | "buddies" | "reminders" | "buddy-new" | `buddy-${number}` | `files-${number}` | `dress-${number}` | `quiz-${number}` | `app-${string}`;

function useScreen(): [Screen, (s: Screen) => void] {
  const read = (): Screen => {
    const h = location.hash.slice(1);
    // "#homework" is the old name for the Homework chat, still used by reminder notifications.
    if (h === "homework") return "app-homework";
    return h === "about" || h === "buddies" || h === "reminders" || h === "buddy-new" || /^(buddy|files|quiz|dress)-\d+$/.test(h) || /^app-[a-z0-9-]+$/.test(h) ? (h as Screen) : "home";
  };
  const [screen, set] = useState<Screen>(read);
  useEffect(() => {
    const on = () => set(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [screen, (s) => (location.hash = s === "home" ? "" : s)];
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">{children}</main>;
}

const TABS: { screen: Screen; label: string; icon: LucideIcon }[] = [
  { screen: "home", label: "Home", icon: HouseIcon },
  { screen: "app-homework", label: "Chat", icon: MessageCircleIcon },
  { screen: "buddies", label: "Buddies", icon: SmileIcon },
];

function TabBar({ screen, go }: { screen: Screen; go: (s: Screen) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-3">
        {TABS.map((t) => (
          <button
            key={t.screen}
            onClick={() => go(t.screen)}
            aria-current={screen === t.screen ? "page" : undefined}
            className={cn("flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold transition-colors", screen === t.screen ? "text-buddy-strong" : "text-muted-foreground")}
          >
            <t.icon className={cn("size-6", screen === t.screen && "fill-buddy/20")} />
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function ChildApp() {
  const token = readToken();
  const { state, send, buddies, loadFiles, schedule, addSchedule, openApp, seeNudges, makeQuiz } = useTutorSocket(token);
  // Text to start the chat with ("Make a quiz" on the Quizzes page).
  const [chatText, setChatText] = useState("");
  // Open the Reminders page straight on the "New reminder" form (from the alarm-clock dropdown's Add).
  const [addingReminder, setAddingReminder] = useState(false);
  const [screen, go] = useScreen();
  const [switching, setSwitching] = useState(false);
  // While a buddy is being made: the buddies that existed before, so the new one can hatch when it arrives.
  const [hatchingFrom, setHatchingFrom] = useState<Set<number> | null>(null);
  const create = (b: BuddyInput) => {
    unlockAudio(); // for the hatching sounds that follow this tap
    setHatchingFrom(new Set(state.buddies.map((x) => x.id)));
    buddies.create(b);
  };
  useBuddyTheme(state.buddy?.color);
  // Opening an app's chat shows that app's conversation with the buddy.
  useEffect(() => {
    if (screen.startsWith("app-") && state.conn === "online") openApp(screen.slice(4));
  }, [screen, state.conn, openApp]);
  // In the buddy's Homework chat, what it said on its own (reminders, check-ins) has been seen.
  const activeId = state.buddy?.id;
  const unseenHere = activeId !== undefined && state.nudges.some((n) => n.buddyId === activeId);
  useEffect(() => {
    if (screen === "app-homework" && unseenHere && activeId !== undefined) seeNudges(activeId);
  }, [screen, unseenHere, activeId, seeNudges]);
  // Files to attach when the chat opens (from "Ask about it" in a buddy's vault).
  const [chatFiles, setChatFiles] = useState<number[]>([]);
  // A buddy's page, its vault and the chat's paperclip show its files: load them when they open.
  useEffect(() => {
    const m = /^(?:buddy|files)-(\d+)$/.exec(screen);
    const id = m ? Number(m[1]) : screen.startsWith("app-") || screen === "home" ? state.buddy?.id : undefined;
    if (id !== undefined && state.conn === "online") loadFiles(id);
  }, [screen, state.conn, state.buddy?.id, loadFiles]);

  if (!token || state.conn === "revoked") {
    return (
      <Centered>
        <LogoMark className="w-24" />
        <h1 className="text-2xl">{state.conn === "revoked" ? "This device was logged out" : "Let's get you connected"}</h1>
        <p className="max-w-xs text-muted-foreground">Ask your parent to show you an OpenBuddies QR code, then scan it with your camera.</p>
      </Centered>
    );
  }
  if (!state.child) {
    return (
      <Centered>
        <LogoMark className="w-20 animate-float" />
        <p className="text-muted-foreground">{state.conn === "offline" ? "Can't reach OpenBuddies. Are you on the home Wi-Fi?" : "Loading…"}</p>
      </Centered>
    );
  }

  const { child, buddy } = state;
  const hatched = hatchingFrom && state.buddies.find((b) => !hatchingFrom.has(b.id));
  if (hatched) {
    return (
      <HatchSplash buddy={hatched} subject={subjectName(child.subjects, hatched.subject)}>
        <Button
          size="lg"
          className="h-12 w-full rounded-2xl bg-buddy text-base font-semibold text-buddy-on hover:bg-buddy/90"
          onClick={() => {
            setHatchingFrom(null);
            go("home");
          }}
        >
          Let's go!
        </Button>
      </HatchSplash>
    );
  }
  if (!buddy) {
    // Their first buddy becomes their main one.
    return (
      <main className="mx-auto min-h-dvh max-w-md px-6 py-8">
        <div className="mb-6 text-center">
          <h1 className="text-3xl">Hi {child.name}!</h1>
          <p className="mt-2 text-muted-foreground">Make your study buddy. It'll help you with homework, one step at a time.</p>
        </div>
        <BuddyMaker childName={child.name} subjects={child.subjects} onSave={create} />
      </main>
    );
  }

  if (screen === "buddies") {
    return (
      <main className="mx-auto min-h-dvh max-w-md pb-24">
        <TopBar title="Your buddies" onBack={() => go("home")} />
        <BuddyList
          buddies={state.buddies}
          activeId={buddy.id}
          subjects={child.subjects}
          onPick={(b) => {
            buddies.switchTo(b.id);
            go("home");
          }}
          onEdit={(b) => go(`buddy-${b.id}`)}
          onNew={() => go("buddy-new")}
        />
        <TabBar screen={screen} go={go} />
      </main>
    );
  }
  if (screen === "buddy-new") {
    return (
      <main className="mx-auto min-h-dvh max-w-md">
        <TopBar title="New buddy" onBack={() => go("buddies")} />
        <div className="px-6 py-6">
          <BuddyMaker
            subjects={child.subjects}
            onSave={create}
          />
        </div>
      </main>
    );
  }
  const editing = screen.startsWith("buddy-") ? state.buddies.find((b) => `buddy-${b.id}` === screen) : undefined;
  if (editing) {
    return (
      <main className="mx-auto min-h-dvh max-w-md">
        <TopBar title={`Change ${editing.name}`} onBack={() => go("buddies")} />
        <BuddyEditor
          buddy={editing}
          subjects={child.subjects}
          parentTitle={child.parentTitle}
          files={state.files[editing.id] ?? []}
          onSave={(b) => {
            buddies.update(editing.id, b);
            go("buddies");
          }}
          onRemove={() => {
            buddies.remove(editing.id);
            go("buddies");
          }}
          onOpenFiles={() => go(`files-${editing.id}`)}
        />
      </main>
    );
  }

  const title = child.parentTitle;
  if (screen === "about") return <AboutPage title={title} buddy={buddy} onBack={() => go("home")} />;
  const dressing = screen.startsWith("dress-") ? state.buddies.find((b) => `dress-${b.id}` === screen) : undefined;
  if (dressing) {
    return (
      <Wardrobe
        buddy={dressing}
        onBack={() => history.back()}
        onSave={(look) => {
          buddies.dress(dressing.id, look);
          history.back();
        }}
      />
    );
  }
  const vaultOf = screen.startsWith("files-") ? state.buddies.find((b) => `files-${b.id}` === screen) : undefined;
  if (vaultOf) {
    return (
      <div style={buddyVars(vaultOf.color)}>
        <FileVault
          buddy={vaultOf}
          files={state.files[vaultOf.id] ?? []}
          parentTitle={title}
          onBack={() => history.back()}
          onChat={(fileId) => {
            // Talk to the buddy whose file it is, with the file ready to send.
            if (vaultOf.id !== buddy.id) buddies.switchTo(vaultOf.id);
            setChatFiles([fileId]);
            go("app-homework");
          }}
        />
      </div>
    );
  }
  if (screen === "reminders") {
    return (
      <div style={buddyVars(buddy.color)}>
        <RemindersPage schedules={state.schedules} buddy={buddy} onAct={schedule} onAdd={addSchedule} error={state.error} startAdding={addingReminder} onBack={() => go("home")} />
      </div>
    );
  }
  // Switching buddy from the home screen or the chat. In the chat, the new buddy's chat replaces the old one.
  const sheet = switching && (
    <BuddySheet
      buddies={state.buddies}
      activeId={buddy.id}
      subjects={child.subjects}
      onPick={(b) => {
        if (b.id !== buddy.id) buddies.switchTo(b.id);
        setSwitching(false);
      }}
      onNew={() => {
        setSwitching(false);
        go("buddy-new");
      }}
      onManage={() => {
        setSwitching(false);
        go("buddies");
      }}
      onClose={() => setSwitching(false)}
    />
  );

  const openTile = screen.startsWith("app-") ? state.apps.find((a) => a.live && `app-${a.id}` === screen) : undefined;
  if (openTile?.kind === "quiz") {
    return (
      <div style={buddyVars(buddy.color)}>
        <QuizzesPage
          buddy={buddy}
          version={state.quizzesVersion[buddy.id] ?? 0}
          onBack={() => go("home")}
          onTake={(id) => go(`quiz-${id}`)}
          onMake={() => {
            setChatText("Can you make me a quiz about ");
            go("app-homework");
          }}
        />
      </div>
    );
  }
  if (screen.startsWith("quiz-")) {
    return (
      <div style={buddyVars(buddy.color)}>
        <QuizPlayer key={screen} buddy={buddy} quizId={Number(screen.slice(5))} onBack={() => history.back()} />
      </div>
    );
  }
  if (openTile) {
    return (
      <div style={buddyVars(buddy.color)}>
        <ScheduleContext.Provider value={{ schedules: state.schedules, act: schedule }}>
          <QuizContext.Provider value={{ choose: makeQuiz, open: (id) => go(`quiz-${id}`) }}>
          <Homework
            key={`${openTile.id}-${buddy.id}`}
            state={state}
            buddy={buddy}
            app={openTile}
            send={(t, files) => {
              setChatFiles([]);
              setChatText("");
              return send(openTile.id, t, files);
            }}
            onBack={() => go("home")}
            onBuddyTap={() => setSwitching(true)}
            onOpenFiles={() => go(`files-${buddy.id}`)}
            initialFiles={chatFiles}
            initialText={chatText}
          />
          </QuizContext.Provider>
        </ScheduleContext.Provider>
        {sheet}
      </div>
    );
  }

  const live = state.apps.filter((a) => a.live);
  const soon = state.apps.filter((a) => !a.live);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-5 pt-[max(20px,env(safe-area-inset-top))] pb-28">
      <header className="flex items-center justify-between gap-3">
        <Wordmark className="text-[2rem] leading-none" />
        {state.conn !== "online" ? (
          <span className="rounded-full bg-sunny-soft px-3 py-1 text-xs font-semibold">Reconnecting…</span>
        ) : (
          <div className="flex items-center gap-2">
            <ReminderBell
              schedules={state.schedules}
              buddy={buddy}
              onOpenAll={(adding) => {
                setAddingReminder(adding);
                go("reminders");
              }}
            />
            <BuddyStack buddies={state.buddies} activeId={buddy.id} news={state.nudges.some((n) => n.buddyId !== buddy.id)} onClick={() => setSwitching(true)} />
          </div>
        )}
      </header>

      <BuddyStage
        buddy={buddy}
        childName={child.name}
        subjects={child.subjects}
        onTap={() => setSwitching(true)}
        nudge={state.nudges.find((n) => n.buddyId === buddy.id) ?? null}
        other={state.buddies.find((b) => b.id !== buddy.id && state.nudges.some((n) => n.buddyId === b.id)) ?? null}
        onOpen={(b) => {
          if (b.id !== buddy.id) buddies.switchTo(b.id);
          go("app-homework");
        }}
        onDress={() => go(`dress-${buddy.id}`)}
      />

      {live.map((a) => (
        <HomeCard key={a.id} art={<Art app={a} className="w-28" />} title={a.name} description={a.description} trailing={<ArrowBubble />} onClick={() => go(`app-${a.id}`)} />
      ))}

      <HomeCard
        art={<FolderArt className="w-28" />}
        title="My files"
        description={(() => {
          const n = state.files[buddy.id]?.length ?? 0;
          return n ? `${n} file${n === 1 ? "" : "s"} shared with ${buddy.name}.` : `Share homework photos and notes with ${buddy.name}.`;
        })()}
        trailing={<ArrowBubble />}
        onClick={() => go(`files-${buddy.id}`)}
      />

      {soon.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-sm font-bold text-muted-foreground">Coming soon</h2>
          {soon.map((a) => (
            <HomeCard
              key={a.id}
              size="md"
              tone="frosted"
              art={<Art app={a} className="w-20" />}
              title={a.name}
              description={a.description}
              trailing={<SoonPill />}
            />
          ))}
        </section>
      )}

      <InstallChip />

      <HomeCard
        size="md"
        tone="frosted"
        art={<ShieldArt className="w-20" />}
        title={`What ${title} can see`}
        description={`How ${title} helps keep you safe and supported.`}
        trailing={<ArrowBubble soft />}
        onClick={() => go("about")}
      />

      <TabBar screen={screen} go={go} />
      {sheet}
    </main>
  );
}

/** The child's buddies as overlapping faces, current one in front. Opens the switcher. */
function BuddyStack({ buddies, activeId, news, onClick }: { buddies: Buddy[]; activeId: number; news: boolean; onClick: () => void }) {
  const ordered = [...buddies.filter((b) => b.id === activeId), ...buddies.filter((b) => b.id !== activeId)].slice(0, 3);
  return (
    <button
      onClick={onClick}
      className="relative flex items-center gap-1 rounded-full border bg-card py-1 pr-2 pl-1 shadow-xs transition-transform active:scale-95"
      aria-label={news ? "Switch buddy (another buddy has something to tell you)" : "Switch buddy"}
    >
      {news && <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-coral ring-2 ring-background" aria-hidden />}
      <span className="flex -space-x-3">
        {ordered.map((b, i) => (
          <span key={b.id} className="rounded-full bg-card p-0.5" style={{ zIndex: 3 - i }}>
            <BuddyFace color={b.color} wear={b.wear} className="size-8" title={b.name} star={b.main} />
          </span>
        ))}
      </span>
      <ChevronDownIcon className="size-4 text-muted-foreground" />
    </button>
  );
}

/** Each app's illustration; apps without one use their icon. */
/** The drawings an app can use on its card (app.yaml `art`), and the coming-soon tiles' own. */
const ART: Record<string, (p: { className?: string }) => React.JSX.Element> = {
  chat: ChatArt,
  quiz: QuizArt,
  books: BooksArt,
  question: QuestionArt,
  notebook: NotebookArt,
  easel: EaselArt,
  chart: ChartArt,
  folder: FolderArt,
  shield: ShieldArt,
};
const SOON_ART: Record<string, string> = { ask: "question", revise: "notebook", progress: "chart" };

function Art({ app, className }: { app: AppTile; className: string }) {
  const Drawn = ART[app.art ?? SOON_ART[app.id] ?? ""];
  return Drawn ? (
    <Drawn className={className} />
  ) : (
    <span className={cn("flex items-center justify-center", className)}>
      <AppIcon name={app.icon} className="size-10 text-buddy-strong" />
    </span>
  );
}

/** A big themed card: illustration, title, one line, and something on the right (an arrow, or "Coming soon"). */
function HomeCard({
  art,
  title,
  description,
  trailing,
  tone = "buddy",
  onClick,
  size = "lg",
}: {
  art: React.ReactNode;
  title: string;
  description: string;
  trailing: React.ReactNode;
  tone?: "buddy" | "frosted";
  onClick?: () => void;
  size?: "lg" | "md";
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-3xl text-left transition-[transform,background-color] duration-500",
        size === "lg" ? "p-4" : "py-3 pr-4 pl-3",
        onClick && "active:scale-[0.98]",
        tone === "buddy" && "bg-buddy-soft",
        tone === "frosted" && "card-buddy",
      )}
    >
      <span className={cn("shrink-0", size === "lg" ? "w-28" : "w-20")}>{art}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block font-bold text-heading", size === "lg" ? "text-2xl" : "text-lg leading-tight")}>{title}</span>
        <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">{description}</span>
      </span>
      {trailing}
    </Tag>
  );
}

function ArrowBubble({ soft = false }: { soft?: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full transition-[transform,background-color] duration-500 group-hover:translate-x-0.5",
        soft ? "size-10 bg-buddy-soft text-buddy-strong" : "size-12 bg-buddy text-buddy-on",
      )}
    >
      {soft ? <ChevronRightIcon className="size-5" /> : <ArrowRightIcon className="size-6" />}
    </span>
  );
}

function SoonPill() {
  return <span className="shrink-0 self-start rounded-full bg-card/80 px-2.5 py-1 text-[11px] font-bold text-buddy-strong">Soon</span>;
}

const INSTALL_DISMISSED = "openbuddies.installDismissed";

/** Offered on the home screen only when the browser can show its own install dialog. */
function InstallChip() {
  const { state, install } = useInstall();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(INSTALL_DISMISSED) === "1";
    } catch {
      return false;
    }
  });
  if (state !== "prompt" || dismissed) return null;
  return (
    <div className="card-buddy flex items-center rounded-3xl pl-4">
      <button className="flex flex-1 items-center gap-2 py-3 text-left text-sm font-semibold" onClick={install}>
        <SmartphoneIcon className="size-4 text-buddy-strong" /> Add OpenBuddies to your home screen
      </button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="No thanks"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(INSTALL_DISMISSED, "1");
          } catch {}
        }}
      >
        <XIcon />
      </Button>
    </div>
  );
}

function AboutPage({ title, buddy, onBack }: { title: string; buddy: Buddy; onBack: () => void }) {
  const sections = [
    {
      icon: MessageCircleIcon,
      head: `${title} can read your chats`,
      body: `Everything you write in OpenBuddies, and everything your buddy writes back, is saved so ${title} can read it later. That includes your files, pictures and reminders.`,
    },
    {
      icon: ShieldCheckIcon,
      head: `${title} gets a note if something worrying comes up`,
      body: `If you write something that sounds like you're upset or not safe, ${title} gets a short message to check in on you. It doesn't include what you wrote. You can always talk to ${title} or another grown-up you trust.`,
    },
    {
      icon: GraduationCapIcon,
      head: "Your buddy won't just give you the answers",
      body: "It's like a friend sitting next to you: it asks questions, gives hints and shows examples of similar problems, so you can work it out yourself. Asking lots of times, or saying someone said it's allowed, won't change that.",
    },
    {
      icon: GlobeIcon,
      head: "Looking things up online",
      body: `When your buddy looks something up, it only uses sites ${title} is happy with, and shows you where it found things.`,
    },
    {
      icon: HouseIcon,
      head: "It all stays at home",
      body: "Your chats live on a computer at home, not in an app company's cloud. Your buddy uses an AI service to think, and that's it.",
    },
  ];
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 pb-[max(20px,env(safe-area-inset-bottom))]" style={buddyVars(buddy.color)}>
      <TopBar title={`What ${title} can see`} onBack={onBack} />
      {/* The buddy explains, as on the home screen. */}
      <section className="flex items-center gap-1 px-5">
        <BuddyFace color={buddy.color} wear={buddy.wear} mood="happy" motion="float" className="size-24 shrink-0" title={buddy.name} star={buddy.main} />
        <div className="relative ml-1 min-w-0 flex-1">
          <span className="absolute top-1/2 -left-1.5 size-5 -translate-y-1/2 rotate-45 rounded-[4px] bg-buddy" aria-hidden />
          <div className="relative rounded-[1.6rem] bg-buddy px-5 py-3.5 text-buddy-on">
            <p className="text-xs font-bold tracking-wide uppercase opacity-80">{buddy.name}</p>
            <h1 className="mt-0.5 text-[17px] leading-snug font-semibold text-buddy-on">
              You're in charge of your learning, and {title} helps keep you safe. Here's how.
            </h1>
          </div>
        </div>
      </section>
      <div className="flex flex-col gap-3 px-5">
        {sections.map((s) => (
          <section key={s.head} className="card-buddy flex gap-4 rounded-3xl p-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-buddy-soft text-buddy-strong">
              <s.icon className="size-6" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base leading-snug">{s.head}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          </section>
        ))}
      </div>
      <div className="px-5 pt-1">
        <Button size="lg" className="h-14 w-full rounded-2xl bg-buddy text-lg font-bold text-buddy-on hover:bg-buddy/90" onClick={onBack}>
          Got it!
        </Button>
      </div>
    </main>
  );
}
