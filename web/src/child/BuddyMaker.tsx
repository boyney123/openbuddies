import { useState, type FormEvent } from "react";
import { DicesIcon, PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BuddyFace, buddyVars } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LookSheet, PaintButton } from "./Wardrobe";
import {
  cleanBuddyDescription,
  cleanBuddyName,
  MAX_BUDDY_DESCRIPTION,
  MAX_SUBJECTS,
  normaliseSubject,
  subjectLabel,
  type Accessory,
  type Buddy,
  type BuddyColor,
  type BuddyInput,
  type SubjectOption,
} from "../../../src/shared/protocol";

const NAME_IDEAS = ["Zippy", "Bolt", "Pixel", "Nova", "Mochi", "Ziggy", "Sparky", "Comet", "Biscuit", "Echo", "Pip", "Rocket"];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-heading">{title}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Chip({ selected, onClick, children }: { selected?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors active:scale-95",
        selected ? "border-buddy bg-buddy text-white" : "bg-card text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/** Make or change a study buddy: name, look (colour and outfit, behind the paint button), who they are, and an optional subject they're best at. */
export function BuddyMaker({
  initial,
  childName,
  subjects,
  onSave,
  saveLabel,
}: {
  initial?: Buddy | null;
  childName?: string;
  /** The child's subjects; the buddy can specialise in one of them. */
  subjects: SubjectOption[];
  onSave: (b: BuddyInput) => void;
  saveLabel?: (name: string) => string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState<BuddyColor>(initial?.color ?? "blue");
  const [wear, setWear] = useState<Accessory[]>(initial?.wear ?? []);
  const [dressing, setDressing] = useState(false);
  const [description, setDescription] = useState(initial?.description ?? "");
  // A subject the parent has since removed falls back to any subject.
  const [subject, setSubject] = useState<string | null>(subjects.some((s) => s.name === initial?.subject) ? initial!.subject : null);
  const [bounce, setBounce] = useState(0);
  // A subject the child typed that isn't one of theirs yet. It's added (as Strict) when the buddy is saved.
  const [added, setAdded] = useState<SubjectOption | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const typed = typing === null ? null : normaliseSubject(typing);
  const options = added ? [...subjects, added] : subjects;
  const addTyped = () => {
    if (!typed) return;
    const existing = subjects.find((s) => s.name === typed);
    if (!existing) setAdded({ name: typed, label: subjectLabel(typed) });
    setSubject(typed);
    setTyping(null);
  };
  const clean = cleanBuddyName(name);
  const tooFancy = name.trim().length > 0 && !clean;
  const cleanDescription = cleanBuddyDescription(description);

  const surprise = () => {
    const options = NAME_IDEAS.filter((n) => n !== name);
    setName(options[Math.floor(Math.random() * options.length)]);
    setBounce((n) => n + 1);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (clean && cleanDescription !== null) onSave({ name: clean, color, wear, description: cleanDescription, subject });
  };

  return (
    <form onSubmit={submit} className="flex flex-col items-center gap-6" style={buddyVars(color)}>
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <div key={bounce} className="animate-pop">
            <BuddyFace color={color} wear={wear} mood={clean ? "happy" : "idle"} className="size-28" />
          </div>
          {/* Its colour and outfit. */}
          <PaintButton name={clean ?? "your buddy"} onClick={() => setDressing(true)} className="absolute -right-2 bottom-0 size-10" />
        </div>
        <p className="text-center text-lg font-semibold text-heading">{clean ? `Hi${childName ? ` ${childName}` : ""}, I'm ${clean}!` : "Give your study buddy a name"}</p>
        <p className="-mt-2 text-center text-sm text-muted-foreground">Tap the brush to pick my colour and outfit.</p>
      </div>
      {dressing && (
        <LookSheet
          start={{ color, wear }}
          name={clean ?? "your buddy"}
          onClose={() => setDressing(false)}
          onDone={(look) => {
            setColor(look.color);
            setWear(look.wear);
            setBounce((n) => n + 1);
            setDressing(false);
          }}
        />
      )}

      <div className="flex w-full max-w-sm flex-col gap-6">
        <Section title="Name">
          <div className="flex gap-2">
            <Input
              value={name}
              maxLength={24}
              autoComplete="off"
              placeholder="Buddy's name"
              aria-label="Buddy's name"
              aria-invalid={tooFancy}
              className="h-12 rounded-2xl bg-card px-4 text-base"
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="button" variant="secondary" size="icon-lg" className="size-12 rounded-2xl" onClick={surprise} aria-label="Pick a random name">
              <DicesIcon className="size-5" />
            </Button>
          </div>
          {tooFancy && <p className="text-sm text-destructive">Use letters and numbers (up to 20).</p>}
        </Section>

        <Section title={`Who is ${clean ?? "your buddy"}?`} hint="Optional">
          <Textarea
            value={description}
            maxLength={MAX_BUDDY_DESCRIPTION}
            rows={2}
            placeholder="e.g. A friendly maths teacher who loves puzzles"
            aria-label="Describe your buddy"
            className="min-h-20 rounded-2xl bg-card px-4 py-3 text-base"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Section>

        <Section title="Best at" hint="Optional">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Subject">
            <Chip selected={subject === null} onClick={() => setSubject(null)}>
              Any subject
            </Chip>
            {options.map((s) => (
              <Chip key={s.name} selected={subject === s.name} onClick={() => setSubject(s.name)}>
                {s.label}
              </Chip>
            ))}
            {typing === null && !added && subjects.length < MAX_SUBJECTS && (
              <Chip onClick={() => setTyping("")}>
                <span className="flex items-center gap-1">
                  <PlusIcon className="size-4" /> New subject
                </span>
              </Chip>
            )}
          </div>
          {typing !== null && (
            <div className="flex gap-2">
              <Input
                autoFocus
                value={typing}
                maxLength={30}
                placeholder="e.g. Chess, Coding, Music"
                aria-label="New subject"
                className="h-11 rounded-2xl bg-card px-4 text-base"
                onChange={(e) => setTyping(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTyped();
                  }
                  if (e.key === "Escape") setTyping(null);
                }}
              />
              <Button type="button" className="h-11 rounded-2xl" disabled={!typed} onClick={addTyped}>
                Add
              </Button>
            </div>
          )}
        </Section>
      </div>

      <Button type="submit" size="lg" disabled={!clean} className="h-12 w-full max-w-sm rounded-2xl text-base font-semibold">
        {clean ? (saveLabel ? saveLabel(clean) : `Meet ${clean}!`) : "Choose a name"}
      </Button>
    </form>
  );
}
