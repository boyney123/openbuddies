import { useEffect, useState, type FormEvent } from "react";
import { BrainIcon, PaperclipIcon, PencilIcon, PlusIcon, StarIcon, Trash2Icon, UserPlusIcon, XIcon } from "lucide-react";
import { FileThumb } from "@/chat/FileParts";
import { BuddyFace, buddyVars } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BuddyMaker } from "../child/BuddyMaker";
import type { Buddy, BuddyFile, BuddyInput } from "../../../src/shared/protocol";
import { api, fmtDate } from "./api";
import { PageHeader } from "./ParentApp";

type Mode = "strict" | "balanced" | "relaxed";
interface ChildView {
  id: string;
  name: string;
  age: number;
  year: string;
  /** How much help in every subject without its own setting. */
  mode: Mode;
  subjects: { name: string; label: string; mode: Mode }[];
  buddies: Buddy[];
  /** The child's own daily token allowance (null: the household's), and what they've used today. */
  allowance: { own: number | null; household: number; usedToday: number };
  /** The buddies' daily check-in. */
  heartbeat: { mode: "on" | "off"; at: string };
  /** Looking things up on the internet, and which search provider is set up (null: none). */
  web: { mode: WebMode; sites: string[]; blocked: string[]; daily_lookups: number; provider: string | null };
}

const MODE_HINT: Record<Mode, string> = { strict: "Never gives answers", balanced: "Answer after real effort", relaxed: "Explains freely" };
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");

function ModeToggle({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <ToggleGroup variant="outline" size="sm" spacing={0} value={[value]} onValueChange={(v) => v[0] && onChange(v[0] as Mode)}>
      {(["strict", "balanced", "relaxed"] as Mode[]).map((m) => (
        <ToggleGroupItem key={m} value={m} title={MODE_HINT[m]} className="px-3 data-pressed:bg-primary data-pressed:text-primary-foreground">
          {label(m)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function Children({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<{ children: ChildView[]; suggested: string[] } | null>(null);
  const [error, setError] = useState("");
  const load = () => api<{ children: ChildView[]; suggested: string[] }>("/children").then(setData, (e) => setError(e.message));
  useEffect(() => void load(), []);

  const replace = (child: ChildView) => setData((d) => d && { ...d, children: d.children.map((c) => (c.id === child.id ? child : c)) });
  const call = async (path: string, init: RequestInit) => {
    setError("");
    try {
      replace(await api<ChildView>(path, init));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const setMode = (childId: string, subject: string, mode: Mode) => call(`/children/${childId}/subjects/${encodeURIComponent(subject)}`, { method: "PUT", body: JSON.stringify({ mode }) });

  if (!data) return <p className="text-muted-foreground">{error || "Loading…"}</p>;
  return (
    <>
      <PageHeader title="Children" />
      {error && <p className="mb-4 rounded-xl bg-coral-soft px-4 py-2 text-sm text-coral">{error}</p>}
      <div className="flex flex-col gap-5">
        {data.children.map((child) => (
          <ChildCard
            key={child.id}
            child={child}
            suggested={data.suggested}
            onMode={(s, m) => setMode(child.id, s, m)}
            onLevel={(m) => call(`/children/${child.id}/mode`, { method: "PUT", body: JSON.stringify({ mode: m }) })}
            onAllowance={(tokens) => call(`/children/${child.id}/allowance`, { method: "PUT", body: JSON.stringify({ tokens }) })}
            onWeb={(change) => call(`/children/${child.id}/web`, { method: "PUT", body: JSON.stringify(change) })}
            onHeartbeat={(change) => call(`/children/${child.id}/heartbeat`, { method: "PUT", body: JSON.stringify(change) })}
            onRemove={(s) => {
              if (confirm(`Remove ${s.label} for ${child.name}? Questions about it will be treated as Strict.`)) call(`/children/${child.id}/subjects/${encodeURIComponent(s.name)}`, { method: "DELETE" });
            }}
            onBuddy={(id, b) => call(`/children/${child.id}/buddies/${id}`, { method: "PUT", body: JSON.stringify(b) })}
            onRemoveBuddy={(b) => {
              if (confirm(`Remove ${b.name}? Its files are deleted too. ${child.name}'s chats with ${b.name} stay in Sessions.`)) call(`/children/${child.id}/buddies/${b.id}`, { method: "DELETE" });
            }}
          />
        ))}
        <AddChild
          onAdded={() => {
            load();
            onChanged();
          }}
        />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">Changes apply to the next message. They're saved in each child's rules.yaml and profile.yaml, which you can also edit by hand.</p>
    </>
  );
}

function ChildCard({
  child,
  suggested,
  onMode,
  onRemove,
  onBuddy,
  onRemoveBuddy,
  onLevel,
  onAllowance,
  onWeb,
  onHeartbeat,
}: {
  child: ChildView;
  suggested: string[];
  onMode: (subject: string, mode: Mode) => Promise<boolean>;
  onRemove: (s: { name: string; label: string }) => void;
  onBuddy: (id: number, b: BuddyInput) => Promise<boolean>;
  onRemoveBuddy: (b: Buddy) => void;
  onLevel: (m: Mode) => void;
  onAllowance: (tokens: number | null) => Promise<boolean>;
  onWeb: (change: { mode?: WebMode; sites?: string[]; blocked?: string[] }) => Promise<boolean>;
  onHeartbeat: (change: { mode?: "on" | "off"; at?: string }) => Promise<boolean>;
}) {
  const [editingBuddy, setEditingBuddy] = useState<number | null>(null);
  // Which buddy's files or memory is open, e.g. "files-3".
  const [showing, setShowing] = useState<string | null>(null);
  const main = child.buddies.find((b) => b.main) ?? null;
  const [name, setName] = useState("");
  const [mode, setNewMode] = useState<Mode>(child.mode);
  const have = new Set(child.subjects.map((s) => s.name));
  const options = suggested.filter((s) => !have.has(s));
  const add = async (subject: string) => {
    if (subject.trim() && (await onMode(subject.trim(), mode))) setName("");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-4">
        <div style={buddyVars(main?.color)}>
          <BuddyFace color={main?.color} wear={main?.wear} className="size-12" title={main?.name} star={!!main} />
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle className="text-lg text-heading">{child.name}</CardTitle>
          <CardDescription>
            {child.age}
            {child.year && ` · ${child.year}`} · {child.buddies.length ? `${child.buddies.length} ${child.buddies.length === 1 ? "buddy" : "buddies"}` : "hasn't made a buddy yet"}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {child.buddies.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Study buddies</h3>
            <div className="divide-y rounded-xl border">
              {child.buddies.map((b) =>
                editingBuddy === b.id ? (
                  <div key={b.id} className="bg-muted/50 p-5">
                    <BuddyMaker
                      initial={b}
                      subjects={child.subjects}
                      saveLabel={() => "Save buddy"}
                      onSave={async (input) => (await onBuddy(b.id, input)) && setEditingBuddy(null)}
                    />
                    <Button variant="ghost" className="mt-2 w-full" onClick={() => setEditingBuddy(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div key={b.id} style={buddyVars(b.color)}>
                    <div className="flex items-start gap-3 px-4 py-3">
                      <BuddyFace color={b.color} wear={b.wear} className="size-10 shrink-0" title={b.name} star={b.main} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">{b.name}</span>
                          {b.main && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-sunny-soft px-2 py-0.5 text-[11px] font-semibold">
                              <StarIcon className="size-3 fill-sunny text-sunny" /> Main
                            </span>
                          )}
                          {b.subject && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">{child.subjects.find((s) => s.name === b.subject)?.label ?? label(b.subject)}</span>}
                        </div>
                        <p className="text-sm text-muted-foreground">{b.description ? `“${b.description}”` : "No description"}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setShowing((s) => (s === `files-${b.id}` ? null : `files-${b.id}`))} aria-expanded={showing === `files-${b.id}`}>
                        <PaperclipIcon /> Files
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowing((s) => (s === `memory-${b.id}` ? null : `memory-${b.id}`))} aria-expanded={showing === `memory-${b.id}`}>
                        <BrainIcon /> Memory
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditingBuddy(b.id)} aria-label={`Edit ${b.name}`}>
                        <PencilIcon />
                      </Button>
                      {!b.main && (
                        <Button variant="ghost" size="icon-sm" onClick={() => onRemoveBuddy(b)} aria-label={`Remove ${b.name}`} className="text-muted-foreground hover:text-destructive">
                          <Trash2Icon />
                        </Button>
                      )}
                    </div>
                    {showing === `files-${b.id}` && <BuddyFilesPanel childId={child.id} buddy={b} />}
                    {showing === `memory-${b.id}` && <BuddyMemoryPanel childId={child.id} buddy={b} />}
                  </div>
                ),
              )}
            </div>
            <p className="text-xs text-muted-foreground">Descriptions shape each buddy's personality only. They can't change the rules or how much help it gives.</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 px-4 py-3">
          <div className="min-w-40 flex-1">
            <h3 className="text-sm font-semibold text-heading">How much help</h3>
            <p className="text-xs text-muted-foreground">For every subject, unless you set one differently below.</p>
          </div>
          <ModeToggle value={child.mode} onChange={(m) => m !== child.mode && onLevel(m)} />
          <span className="hidden w-40 text-xs text-muted-foreground md:block">{MODE_HINT[child.mode]}</span>
        </div>
        <AllowanceSetting child={child} onSet={onAllowance} />
        <WebSetting child={child} onChange={onWeb} />
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 px-4 py-3">
          <div className="min-w-40 flex-1">
            <h3 className="text-sm font-semibold text-heading">Daily check-in</h3>
            <p className="text-xs text-muted-foreground">
              Once a day a buddy may send {child.name} a short message, but only for a good reason in its notes or reminders (a test tomorrow, practice they
              planned). Most days it says nothing.
            </p>
          </div>
          {child.heartbeat.mode === "on" && (
            <label className="flex items-center gap-2 text-sm">
              at
              <Input type="time" value={child.heartbeat.at} onChange={(e) => e.target.value && void onHeartbeat({ at: e.target.value })} className="h-8 w-28 bg-card" aria-label="Check-in time" />
            </label>
          )}
          <ToggleGroup variant="outline" size="sm" spacing={0} value={[child.heartbeat.mode]} onValueChange={(v) => v[0] && v[0] !== child.heartbeat.mode && void onHeartbeat({ mode: v[0] as "on" | "off" })}>
            <ToggleGroupItem value="on" className="px-3 data-pressed:bg-primary data-pressed:text-primary-foreground">
              On
            </ToggleGroupItem>
            <ToggleGroupItem value="off" className="px-3 data-pressed:bg-primary data-pressed:text-primary-foreground">
              Off
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <h3 className="text-sm font-semibold text-muted-foreground">Subjects</h3>
        <div className="divide-y rounded-xl border">
          {child.subjects.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">No subjects yet. {child.name} can add them for their study buddies, or you can add one here.</p>
          )}
          {child.subjects.map((s) => (
            <div key={s.name} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="min-w-28 flex-1 font-semibold">{s.label}</span>
              <ModeToggle value={s.mode} onChange={(m) => m !== s.mode && onMode(s.name, m)} />
              <span className="hidden w-40 text-xs text-muted-foreground md:block">{MODE_HINT[s.mode]}</span>
              <Button variant="ghost" size="icon-sm" onClick={() => onRemove(s)} aria-label={`Remove ${s.label}`} className="text-muted-foreground hover:text-destructive">
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            add(name);
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Add a subject, e.g. French" className="h-9 min-w-48 flex-1" />
          <ModeToggle value={mode} onChange={setNewMode} />
          <Button type="submit" disabled={!name.trim()}>
            <PlusIcon /> Add
          </Button>
        </form>
        {options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {options.slice(0, 8).map((s) => (
              <Button key={s} variant="outline" size="xs" className="rounded-full border-dashed" onClick={() => add(s)}>
                + {label(s)}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddChild({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [year, setYear] = useState("");
  const [mode, setMode] = useState<Mode>("strict");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/children", { method: "POST", body: JSON.stringify({ name, age: Number(age), year, mode }) });
      setOpen(false);
      setName("");
      setAge("");
      setYear("");
      setMode("strict");
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-5 font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
        <UserPlusIcon className="size-5" /> Add a child
      </button>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg text-heading">Add a child</CardTitle>
        <CardDescription>They'll make their own study buddy when they pair a device.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_100px_1fr]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="child-name">First name</Label>
              <Input id="child-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="child-age">Age</Label>
              <Input id="child-age" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="child-year">School year</Label>
              <Input id="child-year" value={year} onChange={(e) => setYear(e.target.value)} placeholder="Year 7" maxLength={40} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>How much help to give</Label>
            <div className="flex flex-wrap items-center gap-3">
              <ModeToggle value={mode} onChange={setMode} />
              <span className="text-sm text-muted-foreground">{MODE_HINT[mode]}</span>
            </div>
            <p className="text-xs text-muted-foreground">Subjects come from their study buddies. You can set any subject differently once it's added.</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !name.trim() || !age}>
              <UserPlusIcon /> Add child
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** A buddy's files, for the parent: open any of them, or remove one. */
function BuddyFilesPanel({ childId, buddy }: { childId: string; buddy: Buddy }) {
  const [files, setFiles] = useState<BuddyFile[] | null>(null);
  const load = () => api<BuddyFile[]>(`/children/${childId}/buddies/${buddy.id}/files`).then(setFiles, () => setFiles([]));
  useEffect(() => void load(), [childId, buddy.id]);
  if (!files) return <p className="px-4 pb-3 text-sm text-muted-foreground">Loading…</p>;
  if (!files.length) return <p className="px-4 pb-3 text-sm text-muted-foreground">{buddy.name} has no files yet.</p>;
  return (
    <ul className="flex flex-col gap-2 px-4 pb-3">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-3">
          <a href={`/api/parent/files/${f.id}`} target="_blank" rel="noreferrer" className="shrink-0">
            <FileThumb file={f} className="size-12" />
          </a>
          <span className="min-w-0 flex-1">
            <a href={`/api/parent/files/${f.id}`} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold hover:underline">
              {f.name}
            </a>
            <span className="block truncate text-xs text-muted-foreground">
              {f.status === "reading" ? "Being read…" : (f.summary ?? (f.kind === "image" ? "Photo" : "Text file"))} · {fmtDate(f.createdAt)}
            </span>
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${f.name}`}
            onClick={async () => {
              if (confirm(`Remove ${f.name}? ${buddy.name} won't be able to look at it any more.`)) {
                await api(`/files/${f.id}`, { method: "DELETE" }).catch(() => {});
                load();
              }
            }}
          >
            <Trash2Icon />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** What a buddy remembers about the child, for the parent: read it, or clear it. */
function BuddyMemoryPanel({ childId, buddy }: { childId: string; buddy: Buddy }) {
  const url = `/children/${childId}/buddies/${buddy.id}/memory`;
  const [memory, setMemory] = useState<{ text: string | null; updatedAt?: string } | null>(null);
  useEffect(() => void api<{ text: string | null; updatedAt?: string }>(url).then(setMemory, () => setMemory({ text: null })), [url]);
  if (!memory) return <p className="px-4 pb-3 text-sm text-muted-foreground">Loading…</p>;
  if (!memory.text) return <p className="px-4 pb-3 text-sm text-muted-foreground">{buddy.name} hasn't made any notes yet. They're written after a few messages.</p>;
  return (
    <div className="flex flex-col gap-2 px-4 pb-3">
      <div className="rounded-xl bg-muted/50 p-3 text-sm leading-relaxed whitespace-pre-wrap">{memory.text}</div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Updated {memory.updatedAt ? fmtDate(memory.updatedAt) : ""}. Kept in data/memory/, editable by hand.</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={async () => {
            if (confirm(`Clear what ${buddy.name} remembers? It starts again from the next chat.`)) {
              await api(url, { method: "DELETE" }).catch(() => {});
              setMemory({ text: null });
            }
          }}
        >
          <Trash2Icon /> Clear
        </Button>
      </div>
    </div>
  );
}

const PRESETS = [
  { key: "light", label: "Light", tokens: 150_000 },
  { key: "normal", label: "Normal", tokens: 400_000 },
  { key: "plenty", label: "Plenty", tokens: 1_000_000 },
];

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** How many AI tokens the child can use a day: the household default, a preset, or a number of the parent's own. */
function AllowanceSetting({ child, onSet }: { child: ChildView; onSet: (tokens: number | null) => Promise<boolean> }) {
  const { own, household, usedToday } = child.allowance;
  const effective = own ?? household;
  const current = own === null ? "default" : (PRESETS.find((p) => p.tokens === own)?.key ?? "custom");
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState(own && current === "custom" ? String(own) : "");
  const pct = Math.min(100, Math.round((usedToday / Math.max(1, effective)) * 100));
  const pick = (key: string) => {
    if (key === "custom") return setCustomOpen(true);
    setCustomOpen(false);
    if (key === current) return;
    void onSet(key === "default" ? null : PRESETS.find((p) => p.key === key)!.tokens);
  };
  const saveCustom = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(custom.replace(/[,_\s]/g, ""));
    if (await onSet(n)) setCustomOpen(false);
  };
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-muted/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-40 flex-1">
          <h3 className="text-sm font-semibold text-heading">Daily AI allowance</h3>
          <p className="text-xs text-muted-foreground">
            {fmtTokens(effective)} tokens a day{own === null && " (household default)"}. When it runs out, OpenBuddies rests until tomorrow.
          </p>
        </div>
        <ToggleGroup variant="outline" size="sm" spacing={0} value={[customOpen ? "custom" : current]} onValueChange={(v) => v[0] && pick(v[0])}>
          <ToggleGroupItem value="default" title={`The household's ${fmtTokens(household)} a day`} className="px-3 data-pressed:bg-primary data-pressed:text-primary-foreground">
            Default
          </ToggleGroupItem>
          {PRESETS.map((p) => (
            <ToggleGroupItem key={p.key} value={p.key} title={`${fmtTokens(p.tokens)} tokens a day`} className="px-3 data-pressed:bg-primary data-pressed:text-primary-foreground">
              {p.label}
            </ToggleGroupItem>
          ))}
          <ToggleGroupItem value="custom" className="px-3 data-pressed:bg-primary data-pressed:text-primary-foreground">
            Custom
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {customOpen && (
        <form onSubmit={saveCustom} className="flex flex-wrap items-center gap-2">
          <Input
            inputMode="numeric"
            placeholder="e.g. 300000"
            value={custom}
            autoFocus
            onChange={(e) => setCustom(e.target.value.replace(/[^\d,_ ]/g, ""))}
            className="h-9 w-40 bg-card"
            aria-label="Tokens a day"
          />
          <span className="text-xs text-muted-foreground">tokens a day</span>
          <Button type="submit" size="sm" disabled={!custom.trim()}>
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setCustomOpen(false)}>
            Cancel
          </Button>
        </form>
      )}
      <div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Used today</span>
          <span className="tabular-nums">
            {fmtTokens(usedToday)} of {fmtTokens(effective)} ({pct}%)
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-card">
          <div className={pct >= 90 ? "h-full rounded-full bg-coral" : "h-full rounded-full bg-primary"} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

type WebMode = "off" | "trusted" | "open";

const WEB_MODES: { mode: WebMode; label: string; hint: string }[] = [
  { mode: "off", label: "Off", hint: "Buddies never look anything up." },
  { mode: "trusted", label: "Trusted sites", hint: "Only educational sites like BBC Bitesize, Britannica, Wikipedia and NASA, plus any you add." },
  { mode: "open", label: "Wider web", hint: "Any site, with SafeSearch on strict. Social media, video and homework-answer sites are always blocked." },
];

/** Whether buddies can look things up on the internet for this child, and which sites. */
function WebSetting({ child, onChange }: { child: ChildView; onChange: (change: { mode?: WebMode; sites?: string[]; blocked?: string[] }) => Promise<boolean> }) {
  const { web } = child;
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-muted/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-40 flex-1">
          <h3 className="text-sm font-semibold text-heading">Internet</h3>
          <p className="text-xs text-muted-foreground">{WEB_MODES.find((m) => m.mode === web.mode)?.hint}</p>
        </div>
        <ToggleGroup variant="outline" size="sm" spacing={0} value={[web.mode]} onValueChange={(v) => v[0] && v[0] !== web.mode && void onChange({ mode: v[0] as WebMode })}>
          {WEB_MODES.map((m) => (
            <ToggleGroupItem key={m.mode} value={m.mode} className="px-3 data-pressed:bg-primary data-pressed:text-primary-foreground">
              {m.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {web.mode !== "off" && !web.provider && (
        <p className="rounded-lg bg-sunny-soft px-3 py-2 text-xs">
          No web search is set up yet, so nothing is looked up. Run <code className="font-mono">openbuddies web setup</code> on the OpenBuddies computer to add one (Brave has a free monthly allowance).
        </p>
      )}
      {web.mode !== "off" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {web.mode === "trusted" && <SiteList title="Also trust" sites={web.sites} placeholder="e.g. historyextra.com" onChange={(sites) => onChange({ sites })} />}
          <SiteList title="Also block" sites={web.blocked} placeholder="e.g. example.com" onChange={(blocked) => onChange({ blocked })} />
        </div>
      )}
      {web.mode !== "off" && web.provider && (
        <p className="text-xs text-muted-foreground">
          Searching with {web.provider === "brave" ? "Brave" : web.provider === "tavily" ? "Tavily" : "SearXNG"}, up to {web.daily_lookups} lookups a day. You can see every lookup and its sources in Sessions.
        </p>
      )}
    </div>
  );
}

/** A short list of sites to add to or remove from. */
function SiteList({ title, sites, placeholder, onChange }: { title: string; sites: string[]; placeholder: string; onChange: (sites: string[]) => Promise<boolean> }) {
  const [draft, setDraft] = useState("");
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim() && (await onChange([...sites, draft.trim()]))) setDraft("");
  };
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">{title}</h4>
      <div className="flex flex-wrap gap-1.5">
        {sites.map((s) => (
          <span key={s} className="flex items-center gap-1 rounded-md border bg-card py-0.5 pr-0.5 pl-2 text-xs">
            {s}
            <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-destructive" onClick={() => void onChange(sites.filter((x) => x !== s))} aria-label={`Remove ${s}`}>
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <form onSubmit={add} className="mt-1.5 flex gap-1.5">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} className="h-8 bg-card text-sm" aria-label={title} />
        <Button type="submit" size="sm" variant="outline" disabled={!draft.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}
