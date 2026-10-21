// The parent's way into sessions: each child, then their buddies, then a buddy's sittings, each level opening with
// totals. A plain dashboard on white; buddy colours appear only as the buddies' small faces, so a parent can tell them
// apart.

import { useEffect, useState } from "react";
import { BellIcon, ChevronRightIcon, ClockIcon, MessageCircleIcon, MessagesSquareIcon, PauseIcon, PlayIcon, PuzzleIcon, ShieldAlertIcon, Trash2Icon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BuddyFace } from "@/components/brand";
import { Button } from "@/components/ui/button";
import type { BuddyColor, ParentBuddyOverview, ParentChildOverview, ParentSessionSummary, ParentStats, QuizSummary, Schedule } from "../../../src/shared/protocol";
import { ago, api, fmtMinutes, navigate, usePoll } from "./api";

// ---- shared pieces ----

export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-muted-foreground" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRightIcon className="size-3.5 opacity-60" />}
          {c.href ? (
            <a
              href={c.href}
              onClick={(e) => {
                e.preventDefault();
                navigate(c.href!);
              }}
              className="hover:text-foreground hover:underline"
            >
              {c.label}
            </a>
          ) : (
            <span className="text-foreground">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function PageTitle({ title, sub, children }: { title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </header>
  );
}

/** One number, with a label above it and an optional note below. */
export function Stat({ icon: Icon, label, value, sub, tone = "plain" }: { icon: LucideIcon; label: string; value: React.ReactNode; sub?: string; tone?: "plain" | "alert" }) {
  return (
    <div className={cn("rounded-xl border bg-card px-4 py-3.5", tone === "alert" && "border-coral/40 bg-coral-soft/40")}>
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        {label}
        <Icon className={cn("size-4", tone === "alert" ? "text-coral" : "opacity-60")} />
      </div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight text-heading tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function StatGrid({ stats }: { stats: ParentStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat icon={MessagesSquareIcon} label="Sessions" value={stats.sessions} sub={`${stats.sessionsThisWeek} in the last 7 days`} />
      <Stat icon={ClockIcon} label="Time learning" value={fmtMinutes(stats.minutes)} sub={`Last active ${ago(stats.lastActiveAt)}`} />
      <Stat icon={PuzzleIcon} label="Problems solved" value={stats.problemsSolved} sub={`of ${stats.problemsAttempted} worked on`} />
      <Stat icon={MessageCircleIcon} label="Messages" value={stats.messages} />
      {stats.alerts > 0 && <Stat icon={BellIcon} label="Alerts" value={stats.alerts} tone="alert" />}
      {stats.blocked > 0 && <Stat icon={ShieldAlertIcon} label="Answers stopped" value={stats.blocked} sub="Blocked before the child saw them" tone="alert" />}
    </div>
  );
}

/** A buddy's small face and name, to tell buddies apart in lists. */
function BuddyTag({ buddy, fallback = "Tutor" }: { buddy: { name: string; color: BuddyColor; main: boolean } | null; fallback?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <BuddyFace color={buddy?.color} className="size-6 shrink-0" title={buddy?.name} />
      <span className="truncate font-medium text-heading">{buddy?.name ?? fallback}</span>
    </span>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const MODE: Record<string, string> = { strict: "Strict", balanced: "Balanced", relaxed: "Relaxed" };

const fmtStart = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Sittings as a table: newest first, one row each, click for the conversation. */
export function SessionTable({ sessions, showChild = false, showBuddy = true }: { sessions: ParentSessionSummary[] | null; showChild?: boolean; showBuddy?: boolean }) {
  if (!sessions) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!sessions.length) return <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">No sessions yet.</p>;
  const open = (s: ParentSessionSummary) => navigate(`/parent/sessions/${s.id}`);
  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead className="hidden bg-muted/60 text-left text-xs font-medium text-muted-foreground md:table-header-group">
          <tr>
            {showChild && <th className="px-4 py-2.5 font-medium">Child</th>}
            {showBuddy && <th className="px-4 py-2.5 font-medium">Buddy</th>}
            <th className="px-4 py-2.5 font-medium">Started</th>
            <th className="px-4 py-2.5 font-medium">Duration</th>
            <th className="px-4 py-2.5 font-medium">Subjects</th>
            <th className="px-4 py-2.5 text-right font-medium">Solved</th>
            <th className="px-4 py-2.5 text-right font-medium">Messages</th>
            <th className="px-4 py-2.5 font-medium">
              <span className="sr-only">Status</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sessions.map((s) => (
            <tr key={s.id} onClick={() => open(s)} className="group cursor-pointer align-middle transition-colors hover:bg-muted/50">
              {/* Phones: one compact cell. */}
              <td className="px-4 py-3 md:hidden" colSpan={8}>
                <div className="flex items-center gap-3">
                  <BuddyFace color={s.buddy?.color} wear={s.buddy?.wear} className="size-8 shrink-0" title={s.buddy?.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-heading">
                      {[showChild && s.childName, showBuddy && (s.buddy?.name ?? s.app)].filter(Boolean).join(" · ") || fmtStart(s.startedAt)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtStart(s.startedAt)} · {fmtMinutes(s.minutes)} · {s.problemsSolved}/{s.problemsAttempted} solved
                    </div>
                  </div>
                  <Status s={s} />
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </div>
              </td>
              {showChild && <td className="hidden px-4 py-3 font-medium text-heading md:table-cell">{s.childName}</td>}
              {showBuddy && (
                <td className="hidden px-4 py-3 md:table-cell">
                  <BuddyTag buddy={s.buddy} fallback={s.app} />
                </td>
              )}
              <td className="hidden px-4 py-3 whitespace-nowrap text-muted-foreground md:table-cell">{fmtStart(s.startedAt)}</td>
              <td className="hidden px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums md:table-cell">{fmtMinutes(s.minutes)}</td>
              <td className="hidden px-4 py-3 text-muted-foreground capitalize md:table-cell">{s.subjects.map((x) => x.replace(/-/g, " ")).join(", ") || "–"}</td>
              <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
                {s.problemsSolved}/{s.problemsAttempted}
              </td>
              <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">{s.turns}</td>
              <td className="hidden px-4 py-3 md:table-cell">
                <div className="flex items-center justify-end gap-2">
                  <Status s={s} />
                  <ChevronRightIcon className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Status({ s }: { s: ParentSessionSummary }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {!s.endedAt && <span className="rounded-md bg-mint-soft px-1.5 py-0.5 text-[11px] font-semibold text-[#17784f]">Live</span>}
      {s.alerts > 0 && (
        <span className="flex items-center gap-1 rounded-md bg-coral-soft px-1.5 py-0.5 text-[11px] font-semibold text-[#c2352a]">
          <BellIcon className="size-3" /> {s.alerts}
        </span>
      )}
    </span>
  );
}

function useOverview() {
  return usePoll<{ children: ParentChildOverview[] }>("/overview", 10_000)[0];
}

// ---- the pages ----

/** Everyone at a glance: a card per child, and the latest sittings. */
export function Overview({ parentName }: { parentName: string }) {
  const data = useOverview();
  const [recent] = usePoll<ParentSessionSummary[]>("/sessions", 10_000);
  return (
    <>
      <PageTitle title="Overview" sub={`Welcome back, ${parentName}. Choose a child to see their buddies and sessions.`} />
      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.children.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/parent/child/${c.id}`)}
              className="group flex flex-col rounded-xl border bg-card text-left transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm"
            >
              <div className="flex items-center gap-3 px-5 pt-4 pb-3">
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold text-heading">{c.name}</div>
                  <div className="text-sm text-muted-foreground">{[`Age ${c.age}`, c.year, `${MODE[c.mode]} help`].filter(Boolean).join(" · ")}</div>
                </div>
                {c.stats.alerts > 0 && (
                  <span className="flex items-center gap-1 rounded-md bg-coral-soft px-2 py-0.5 text-xs font-semibold text-[#c2352a]">
                    <BellIcon className="size-3" /> {c.stats.alerts}
                  </span>
                )}
                <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <dl className="grid grid-cols-3 divide-x border-y">
                {[
                  ["Sessions (7 days)", c.stats.sessionsThisWeek],
                  ["Problems solved", `${c.stats.problemsSolved}/${c.stats.problemsAttempted}`],
                  ["Time learning", fmtMinutes(c.stats.minutes)],
                ].map(([label, value]) => (
                  <div key={label as string} className="px-5 py-3">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 text-lg font-semibold text-heading tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex items-center gap-3 px-5 py-3 text-xs text-muted-foreground">
                <span className="flex -space-x-1.5">
                  {c.buddies.slice(0, 5).map((b) => (
                    <BuddyFace key={b.id} color={b.color} wear={b.wear} className="size-6 rounded-md ring-2 ring-card" title={b.name} />
                  ))}
                </span>
                <span className="truncate">{c.buddies.length ? c.buddies.map((b) => b.name).join(", ") : "No buddies yet"}</span>
                <span className="ml-auto shrink-0">Active {ago(c.stats.lastActiveAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      <Section title="Latest sessions">
        <SessionTable sessions={recent?.slice(0, 10) ?? null} showChild={(data?.children.length ?? 0) > 1} />
      </Section>
    </>
  );
}

/** One child: their totals, their buddies, and every sitting. */
export function ChildPage({ id }: { id: string }) {
  const data = useOverview();
  const [sessions] = usePoll<ParentSessionSummary[]>(`/sessions?child=${encodeURIComponent(id)}`, 10_000);
  const child = data?.children.find((c) => c.id === id);
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!child) return <p className="text-sm text-muted-foreground">That child isn't in this household.</p>;
  const usedPct = Math.min(100, Math.round((child.usage.today / Math.max(1, child.usage.budget)) * 100));
  return (
    <>
      <Crumbs items={[{ label: "Overview", href: "/parent" }, { label: child.name }]} />
      <PageTitle title={child.name} sub={[`Age ${child.age}`, child.year, `${MODE[child.mode]} help`].filter(Boolean).join(" · ")}>
        <div className="w-full rounded-xl border px-4 py-3 sm:w-64">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Today's token allowance</span>
            <span className="tabular-nums">{usedPct}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", usedPct >= 90 ? "bg-coral" : "bg-primary")} style={{ width: `${usedPct}%` }} />
          </div>
        </div>
      </PageTitle>
      <StatGrid stats={child.stats} />

      <Section title="Buddies">
        {child.buddies.length === 0 ? (
          <p className="text-sm text-muted-foreground">{child.name} hasn't made a buddy yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <ul className="divide-y">
              {child.buddies.map((b) => (
                <BuddyRow key={b.id} buddy={b} onClick={() => navigate(`/parent/child/${id}/buddy/${b.id}`)} />
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Reminders and plans">
        <ScheduleTable childId={id} buddies={child.buddies} />
      </Section>

      <Section title="All sessions">
        <SessionTable sessions={sessions} />
      </Section>
    </>
  );
}

/** A child's reminders and plans, which they set up by asking a buddy. The parent can pause, restart or delete any. */
function ScheduleTable({ childId, buddies }: { childId: string; buddies: ParentBuddyOverview[] }) {
  const [schedules, reload] = usePoll<Schedule[]>(`/children/${encodeURIComponent(childId)}/schedules`, 15_000);
  const [error, setError] = useState("");
  const act = (s: Schedule, action: "pause" | "resume" | "delete") => {
    if (action === "delete" && !confirm(`Delete "${s.label}"?`)) return;
    setError("");
    api(`/schedules/${s.id}`, { method: "PUT", body: JSON.stringify({ action }) }).then(reload, (e) => setError(e.message));
  };
  const live = schedules?.filter((s) => s.status === "active" || s.status === "paused") ?? null;
  if (!live) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!live.length) return <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">None yet. Children set these up by asking a buddy, e.g. "remind me tomorrow at 8 to pack my PE kit".</p>;
  return (
    <>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Reminder</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Buddy</th>
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="hidden px-4 py-2.5 font-medium md:table-cell">Next</th>
              <th className="px-4 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {live.map((s) => {
              const b = buddies.find((x) => x.id === s.buddyId) ?? null;
              const paused = s.status === "paused";
              return (
                <tr key={s.id} className={cn(paused && "text-muted-foreground")}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-heading">{s.label}</div>
                    <div className="text-xs text-muted-foreground">{s.kind === "task" ? `Buddy will: ${s.text}` : `Reminder: ${s.text}`}</div>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <BuddyTag buddy={b} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{s.when}</td>
                  <td className="hidden px-4 py-3 whitespace-nowrap md:table-cell">{paused ? "Paused" : s.nextAt ? new Date(s.nextAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "–"}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon-sm" onClick={() => act(s, paused ? "resume" : "pause")} aria-label={paused ? `Restart ${s.label}` : `Pause ${s.label}`}>
                      {paused ? <PlayIcon /> : <PauseIcon />}
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => act(s, "delete")} aria-label={`Delete ${s.label}`}>
                      <Trash2Icon />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BuddyRow({ buddy, onClick }: { buddy: ParentBuddyOverview; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="group flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/50">
        <BuddyFace color={buddy.color} wear={buddy.wear} className="size-10 shrink-0" title={buddy.name} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-heading">{buddy.name}</span>
            {buddy.main && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Main</span>}
            {buddy.subject && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground capitalize">{buddy.subject.replace(/-/g, " ")}</span>}
          </div>
          {buddy.description && <p className="truncate text-sm text-muted-foreground">{buddy.description}</p>}
        </div>
        <dl className="hidden shrink-0 gap-6 text-right text-sm sm:flex">
          <div>
            <dt className="text-xs text-muted-foreground">Sessions</dt>
            <dd className="font-medium tabular-nums">{buddy.stats.sessions}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Solved</dt>
            <dd className="font-medium tabular-nums">
              {buddy.stats.problemsSolved}/{buddy.stats.problemsAttempted}
            </dd>
          </div>
          <div className="w-24">
            <dt className="text-xs text-muted-foreground">Last chat</dt>
            <dd className="font-medium">{ago(buddy.stats.lastActiveAt)}</dd>
          </div>
        </dl>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </button>
    </li>
  );
}

/** One buddy: who it is, its totals, what it remembers, and its sittings. */
export function BuddyPage({ childId, buddyId }: { childId: string; buddyId: number }) {
  const data = useOverview();
  const [sessions] = usePoll<ParentSessionSummary[]>(`/sessions?child=${encodeURIComponent(childId)}&buddy=${buddyId}`, 10_000);
  const [memory, setMemory] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    api<{ text: string | null }>(`/children/${encodeURIComponent(childId)}/buddies/${buddyId}/memory`).then(
      (m) => setMemory(m.text),
      () => setMemory(null),
    );
  }, [childId, buddyId]);
  const child = data?.children.find((c) => c.id === childId);
  const buddy = child?.buddies.find((b) => b.id === buddyId);
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!child || !buddy) return <p className="text-sm text-muted-foreground">That buddy isn't around any more.</p>;
  return (
    <>
      <Crumbs items={[{ label: "Overview", href: "/parent" }, { label: child.name, href: `/parent/child/${childId}` }, { label: buddy.name }]} />
      <header className="mb-6 flex items-center gap-4">
        <BuddyFace color={buddy.color} wear={buddy.wear} className="size-14 shrink-0" title={buddy.name} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{buddy.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[`${child.name}'s ${buddy.main ? "main " : ""}study buddy`, buddy.subject && `Specialises in ${buddy.subject.replace(/-/g, " ")}`].filter(Boolean).join(" · ")}
          </p>
          {buddy.description && <p className="mt-1 text-sm">Described by {child.name} as "{buddy.description}"</p>}
        </div>
      </header>
      <StatGrid stats={buddy.stats} />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0">
          <h2 className="mb-3 text-base font-semibold">Sessions</h2>
          <SessionTable sessions={sessions} showBuddy={false} />
        </section>
        <aside className="flex flex-col gap-6">
          <BuddyQuizzes childId={childId} buddyId={buddyId} />
          <div>
          <h2 className="mb-3 text-base font-semibold">Memory notes</h2>
          <div className="rounded-xl border p-4 text-sm leading-relaxed">
            {memory === undefined ? (
              <span className="text-muted-foreground">Loading…</span>
            ) : memory ? (
              <MemoryNotes text={memory} />
            ) : (
              <span className="text-muted-foreground">No notes yet. {buddy.name} writes notes after each session.</span>
            )}
          </div>
          </div>
        </aside>
      </div>
    </>
  );
}

/** The quizzes a buddy made, with the child's best score on each. */
function BuddyQuizzes({ childId, buddyId }: { childId: string; buddyId: number }) {
  const [quizzes] = usePoll<QuizSummary[]>(`/children/${encodeURIComponent(childId)}/buddies/${buddyId}/quizzes`, 30_000);
  const ready = quizzes?.filter((q) => q.status === "ready") ?? [];
  return (
    <div>
      <h2 className="mb-3 text-base font-semibold">Quizzes</h2>
      {!quizzes ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : ready.length === 0 ? (
        <p className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">None yet. Children ask for one in a chat.</p>
      ) : (
        <ul className="divide-y rounded-xl border text-sm">
          {ready.map((q) => (
            <li key={q.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-heading">{q.title}</div>
                <div className="text-xs text-muted-foreground">
                  {q.count} questions · {q.style === "multiple_choice" ? "multiple choice" : "typed"} · taken {q.attempts}×
                </div>
              </div>
              <span className="shrink-0 font-medium tabular-nums">{q.best ? `${q.best.score}/${q.best.total}` : "–"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The buddy's Markdown notes: headings as small labels, bullets as a list. */
function MemoryNotes({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1">
      {text.split("\n").map((line, i) =>
        /^#+\s/.test(line) ? (
          <p key={i} className="mt-3 text-xs font-medium text-muted-foreground first:mt-0">
            {line.replace(/^#+\s*/, "")}
          </p>
        ) : line.trim() ? (
          <p key={i} className="flex gap-2">
            <span className="text-muted-foreground">–</span>
            <span>{line.replace(/^\s*[-*]\s*/, "")}</span>
          </p>
        ) : null,
      )}
    </div>
  );
}
