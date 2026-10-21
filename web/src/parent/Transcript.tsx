// A session as the child saw it (same chat components), with the parent-only details beside each turn:
// classifier labels, the action and rung, rejected tool calls, alerts and any drafts the leak check blocked.

import { useEffect } from "react";
import { BellIcon, BellRingIcon, CheckIcon, CircleCheckIcon, ClockIcon, LightbulbIcon, MessageCircleIcon, PinIcon, PuzzleIcon, ShieldAlertIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BuddyFace, buddyVars } from "@/components/brand";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { ChildMessage, isTutorSide, NoticePill, ReminderCard, SolvedMarker, TextBubble, TutorItem, TutorMessage } from "@/chat/ChatParts";
import type { Buddy, ChatItem, ParentSessionProblem, ParentTurn } from "../../../src/shared/protocol";
import { fmtDate, fmtMinutes, fmtTime, usePoll } from "./api";
import { Crumbs, Stat } from "./Overview";

interface SessionView {
  session: { childId: string; childName: string; app: string; startedAt: string; endedAt: string | null; buddy: Buddy | null };
  problems: ParentSessionProblem[];
  turns: ParentTurn[];
}

const RUNG: Record<string, string> = { ask: "Ask", nudge: "Nudge", worked_example: "Example", check: "Check" };

function Tag({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "blue" | "red" | "amber" | "strong" }) {
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[11.5px] font-medium",
        tone === "plain" && "bg-muted text-muted-foreground",
        tone === "blue" && "bg-blue-soft text-primary",
        tone === "red" && "bg-coral-soft text-coral",
        tone === "amber" && "bg-sunny-soft text-[#9a6200] dark:text-sunny",
        tone === "strong" && "bg-secondary font-semibold text-secondary-foreground",
      )}
    >
      {children}
    </span>
  );
}

function ChildNotes({ turn, prevRung }: { turn: ParentTurn; prevRung: string | null }) {
  const i = turn.intent as any;
  const a = turn.action as any;
  if (!i && !a) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {i && <Tag tone="blue">{i.intent.replace(/_/g, " ")}</Tag>}
      {i && i.pressure !== "none" && <Tag tone={i.pressure === "jailbreak" ? "red" : "amber"}>pressure: {i.pressure}</Tag>}
      {i && i.welfare !== "fine" && <Tag tone="red">welfare: {i.welfare}</Tag>}
      {i && <Tag>{i.subject}</Tag>}
      {a && <Tag tone="strong">→ {a.kind.replace(/_/g, " ")}</Tag>}
      {a?.rung && <Tag tone="strong">{prevRung && prevRung !== a.rung ? `${RUNG[prevRung] ?? prevRung} → ${RUNG[a.rung] ?? a.rung}` : `rung: ${RUNG[a.rung] ?? a.rung}`}</Tag>}
      {a && <Tag>{a.mode}</Tag>}
      {a?.newProblem && <Tag tone="blue">new problem</Tag>}
    </div>
  );
}

function TutorNotes({ turn }: { turn: ParentTurn }) {
  if (!turn.toolCalls.length && !turn.blocked.length) return null;
  return (
    <div className="flex flex-col gap-1 text-xs">
      {turn.toolCalls.map((c, i) => (
        <div key={i} className={cn("flex items-start gap-1", c.accepted ? "text-muted-foreground" : "text-[#9a6200] dark:text-sunny")}>
          {c.accepted ? <CheckIcon className="mt-0.5 size-3 shrink-0" /> : <XIcon className="mt-0.5 size-3 shrink-0" />}
          <span>
            <code className="font-mono">{c.tool}</code>
            {!c.accepted && c.error && <span>: {c.error}</span>}
          </span>
        </div>
      ))}
      {turn.blocked.length > 0 && (
        <div className="flex items-center gap-1 font-semibold text-coral">
          <ShieldAlertIcon className="size-3" /> {turn.blocked.length} draft{turn.blocked.length > 1 ? "s" : ""} blocked
        </div>
      )}
    </div>
  );
}

function BlockedDraft({ text, reason, childName }: { text: string; reason: string; childName: string }) {
  return (
    <Collapsible className="ml-11 max-w-[85%] rounded-2xl border border-dashed border-coral/50 bg-coral-soft/60 px-3.5 py-2 text-sm">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-left font-semibold text-coral">
        <ShieldAlertIcon className="size-4 shrink-0" />
        <span className="flex-1">Blocked before {childName} saw it</span>
        <span className="text-xs font-normal underline">show</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-1.5 text-xs text-muted-foreground">Why: {reason}</p>
        <p className="mt-1.5 whitespace-pre-wrap text-foreground/80 line-through decoration-coral/50">{text}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TurnChat({ turn, buddy, childName }: { turn: ParentTurn; buddy: Buddy | null; childName: string }) {
  const reminder = turn.items.find((i) => i.kind === "reminder") as Extract<ChatItem, { kind: "reminder" }> | undefined;
  if (turn.role === "child") {
    const item = turn.items.find((i) => i.kind === "child") as Extract<ChatItem, { kind: "child" }> | undefined;
    return (
      <div className="flex flex-col gap-2">
        {reminder ? <ReminderCard item={reminder} at={turn.createdAt} /> : <ChildMessage messages={[item ?? { text: turn.text }]} />}
        {turn.items
          .filter((i) => i.kind === "files_used" || i.kind === "looked_up")
          .map((i, n) => (
            <TutorMessage key={n} color={buddy?.color} wear={buddy?.wear} name={buddy?.name}>
              <TutorItem item={i} />
            </TutorMessage>
          ))}
        {turn.alerts.map((a, i) => (
          <div key={i} className="ml-auto flex max-w-[85%] items-center gap-1.5 rounded-xl bg-coral-soft px-3 py-1.5 text-xs font-medium text-coral">
            <BellRingIcon className="size-3.5 shrink-0" /> You were alerted: {a.summary}
          </div>
        ))}
      </div>
    );
  }
  const pinned = turn.toolCalls.find((c) => c.tool === "set_active_problem" && c.accepted)?.args as { label?: string } | undefined;
  const tutorItems = turn.items.filter(isTutorSide);
  const solved = turn.items.find((i) => i.kind === "solved") as { label: string } | undefined;
  const notice = turn.items.find((i) => i.kind === "notice") as { text: string } | undefined;
  return (
    <div className="flex flex-col gap-2">
      {pinned?.label && (
        <Marker variant="separator" className="text-xs">
          <PinIcon className="size-3" />
          <MarkerContent>Working on {pinned.label}</MarkerContent>
        </Marker>
      )}
      {turn.blocked.map((b, i) => (
        <BlockedDraft key={i} text={b.text} reason={b.reason} childName={childName} />
      ))}
      {reminder ? (
        <ReminderCard item={reminder} at={turn.createdAt} />
      ) : notice ? (
        <NoticePill text={notice.text} />
      ) : tutorItems.length ? (
        <TutorMessage color={buddy?.color} wear={buddy?.wear} name={buddy?.name}>
          {tutorItems.map((item, i) => (
            <TutorItem key={i} item={item} />
          ))}
        </TutorMessage>
      ) : (
        <TutorMessage color={buddy?.color} wear={buddy?.wear} name={buddy?.name}>
          <TextBubble text={turn.text} />
        </TutorMessage>
      )}
      {solved && <SolvedMarker label={solved.label} />}
    </div>
  );
}

export function Transcript({ id, focusTurn }: { id: number; focusTurn?: number }) {
  const [data] = usePoll<SessionView>(`/sessions/${id}`, 4000);
  useEffect(() => {
    if (data && focusTurn) document.getElementById(`turn-${focusTurn}`)?.scrollIntoView({ block: "center" });
  }, [data, focusTurn]);
  if (!data) return <p className="text-muted-foreground">Loading…</p>;

  const { session, turns } = data;
  const buddy = session.buddy;
  let prevRung: string | null = null;

  return (
    <>
      <Crumbs
        items={[
          { label: "Overview", href: "/parent" },
          { label: session.childName, href: `/parent/child/${session.childId}` },
          ...(buddy ? [{ label: buddy.name, href: `/parent/child/${session.childId}/buddy/${buddy.id}` }] : []),
          { label: fmtDate(session.startedAt) },
        ]}
      />
      <SessionOverview data={data} />

      <h2 className="mt-8 mb-3 text-base font-semibold">Conversation</h2>
      <div className="overflow-hidden rounded-xl border" style={buddyVars(buddy?.color)}>
        <div className="hidden grid-cols-[minmax(0,1fr)_280px] border-b bg-muted/60 text-xs font-medium text-muted-foreground lg:grid">
          <div className="px-5 py-2">What {session.childName} saw</div>
          <div className="border-l px-4 py-2">Behind the scenes</div>
        </div>
        {turns.map((t) => {
          const rungBefore = prevRung;
          if (t.role === "child" && (t.action as any)?.rung) prevRung = (t.action as any).rung;
          return (
            <div key={t.id} id={`turn-${t.id}`} className={cn("grid lg:grid-cols-[minmax(0,1fr)_280px]", focusTurn === t.id && "bg-coral-soft/40")}>
              <div className="bg-background px-3 py-2.5 sm:px-5">
                <TurnChat turn={t} buddy={buddy} childName={session.childName} />
              </div>
              <div className="flex flex-col gap-1.5 border-t px-4 py-2.5 lg:border-t-0 lg:border-l">
                <span className="text-[11px] text-muted-foreground">
                  {fmtTime(t.createdAt)} · {t.role === "child" ? session.childName : buddy?.name ?? "Tutor"}
                </span>
                {t.role === "child" ? <ChildNotes turn={t} prevRung={rungBefore} /> : <TutorNotes turn={t} />}
                {t.role === "child" && (t.intent as any)?.welfare === "concerning" && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-coral">
                    <TriangleAlertIcon className="size-3" /> Tutoring paused for welfare
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {turns.length === 0 && <p className="px-5 py-10 text-center text-muted-foreground">No messages in this session.</p>}
      </div>
    </>
  );
}

const LADDER = ["ask", "nudge", "worked_example", "check"] as const;

/** How far up the hint ladder a problem went: one step per rung, filled up to where it got to. */
function LadderSteps({ rung }: { rung: string }) {
  const reached = LADDER.indexOf(rung as (typeof LADDER)[number]);
  return (
    <span className="flex items-center gap-1" title={`Got to the ${RUNG[rung] ?? rung} step`}>
      {LADDER.map((r, i) => (
        <span key={r} className={cn("h-1.5 w-5 rounded-full", i <= reached ? "bg-primary" : "bg-muted")} />
      ))}
      <span className="ml-1 w-14 text-xs text-muted-foreground">{RUNG[rung] ?? rung}</span>
    </span>
  );
}

/** The sitting at a glance: who, when, how long, and what happened, before the full conversation. */
function SessionOverview({ data }: { data: SessionView }) {
  const { session, turns, problems } = data;
  const buddy = session.buddy;
  const items = turns.flatMap((t) => t.items);
  const hints = items.filter((i) => i.kind === "hint").length;
  const examples = items.filter((i) => i.kind === "worked_example").length;
  const checks = items.filter((i) => i.kind === "check") as Extract<ChatItem, { kind: "check" }>[];
  const blocked = turns.reduce((n, t) => n + t.blocked.length, 0);
  const alerts = turns.reduce((n, t) => n + t.alerts.length, 0);
  const pushes = turns.filter((t) => t.role === "child" && (t.intent as any)?.pressure && (t.intent as any).pressure !== "none").length;
  const last = turns.at(-1)?.createdAt ?? session.startedAt;
  const minutes = Math.round((Date.parse(last) - Date.parse(session.startedAt)) / 60_000);
  const childMessages = turns.filter((t) => t.role === "child").length;
  const solved = problems.filter((p) => p.solved).length;

  return (
    <section>
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <BuddyFace color={buddy?.color} wear={buddy?.wear} className="size-12 shrink-0" title={buddy?.name} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {session.childName} with {buddy?.name ?? "the tutor"}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {fmtDate(session.startedAt)} to {fmtTime(last)} · <span className="capitalize">{session.app}</span>
          </p>
        </div>
        {!session.endedAt && <span className="rounded-md bg-mint-soft px-2 py-1 text-xs font-semibold text-[#17784f]">Live now</span>}
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={ClockIcon} label="Time" value={fmtMinutes(minutes)} />
        <Stat icon={MessageCircleIcon} label="Messages" value={turns.length} sub={`${childMessages} from ${session.childName}`} />
        <Stat icon={PuzzleIcon} label="Problems solved" value={solved} sub={`of ${problems.length} worked on`} />
        <Stat icon={LightbulbIcon} label="Hints given" value={hints} sub={`${examples} worked example${examples === 1 ? "" : "s"}`} />
        {checks.length > 0 && <Stat icon={CircleCheckIcon} label="Answers checked" value={checks.length} sub={`${checks.filter((c) => c.correct).length} correct`} />}
        {pushes > 0 && <Stat icon={TriangleAlertIcon} label="Pushed for the answer" value={pushes} sub="The buddy held firm" />}
        {blocked > 0 && <Stat icon={ShieldAlertIcon} label="Answers stopped" value={blocked} sub="Blocked before they were seen" tone="alert" />}
        {alerts > 0 && <Stat icon={BellIcon} label="Alerts" value={alerts} tone="alert" />}
      </div>

      {problems.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-base font-semibold">Problems worked on</h2>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Problem</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Subject</th>
                  <th className="px-4 py-2.5 font-medium">Help reached</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Attempts</th>
                  <th className="px-4 py-2.5 text-right font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {problems.map((p, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3 font-medium text-heading">{p.label}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground capitalize sm:table-cell">{p.subject?.replace(/-/g, " ") ?? "–"}</td>
                    <td className="px-4 py-3">
                      <LadderSteps rung={p.rung} />
                    </td>
                    <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">{p.attempts}</td>
                    <td className="px-4 py-3 text-right">
                      {p.solved ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-mint-soft px-1.5 py-0.5 text-xs font-semibold text-[#17784f]">
                          <CheckIcon className="size-3" /> Solved
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
