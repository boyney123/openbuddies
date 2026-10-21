// Changing how a buddy looks: its colour, and one thing on its head, one over its eyes and one round its neck. A big
// preview of the buddy tries each pick on straight away (with a happy hop). The paint button opens it, on the home
// screen (the Wardrobe page, which saves at once) and while making or changing a buddy (the LookSheet, saved with it).

import { useState } from "react";
import { BanIcon, CheckIcon, PaintbrushIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BuddyFace, buddyVars } from "@/components/brand";
import { ACCESSORIES, BUDDY_COLORS, type Accessory, type Buddy, type BuddyColor, type WearSlot } from "../../../src/shared/protocol";
import { Hills } from "./BuddyStage";
import { TopBar } from "./TopBar";

export interface Look {
  color: BuddyColor;
  wear: Accessory[];
}

const COLORS = Object.keys(BUDDY_COLORS) as BuddyColor[];

const LABEL: Record<Accessory, string> = {
  cap: "Cap",
  beanie: "Beanie",
  crown: "Crown",
  party: "Party hat",
  wizard: "Wizard hat",
  headphones: "Headphones",
  glasses: "Glasses",
  sunglasses: "Shades",
  chain: "Gold chain",
  scarf: "Scarf",
  bowtie: "Bow tie",
  medal: "Medal",
};

const SLOTS: { slot: WearSlot; title: string }[] = [
  { slot: "head", title: "On its head" },
  { slot: "eyes", title: "Over its eyes" },
  { slot: "neck", title: "Round its neck" },
];

const sameLook = (a: Look, b: Look) => a.color === b.color && a.wear.length === b.wear.length && a.wear.every((x) => b.wear.includes(x));

/** The small round paint button that opens the look picker, pinned to a corner of a buddy. */
export function PaintButton({ name, onClick, className, ...rest }: { name: string; onClick: () => void; className?: string } & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex size-8 items-center justify-center rounded-full bg-card text-buddy-strong shadow-md ring-2 ring-buddy/40 transition-transform active:scale-90", className)}
      aria-label={`Change how ${name} looks`}
      {...rest}
    >
      <PaintbrushIcon className="size-4" />
    </button>
  );
}

/** The buddy trying its look on, on its hills. `tries` changes on every pick, so it hops again. */
function Preview({ look, tries, name, main }: { look: Look; tries: number; name: string; main?: boolean }) {
  return (
    <section className="relative mx-4 h-48 shrink-0 rounded-3xl bg-buddy-soft" aria-label={`${name} trying things on`}>
      <Hills />
      <div className="absolute inset-x-0 bottom-4 flex justify-center">
        <BuddyFace key={tries} color={look.color} wear={look.wear} mood={tries > 0 ? "happy" : "idle"} motion={tries > 0 ? "hop" : "none"} className="size-32" title={name} star={main} />
      </div>
    </section>
  );
}

/** Colour swatches, then what it can wear in each place. */
function LookPicker({ look, name, onPick }: { look: Look; name: string; onPick: (look: Look) => void }) {
  const wearIn = (slot: WearSlot, a: Accessory | null) => onPick({ ...look, wear: [...look.wear.filter((x) => ACCESSORIES[x] !== slot), ...(a ? [a] : [])] });
  return (
    <>
      <section className="px-4 pt-6">
        <h2 className="mb-2 px-1 text-sm font-bold tracking-wide text-muted-foreground uppercase">{name}'s colour</h2>
        <div className="grid grid-cols-8 justify-items-center gap-1 rounded-2xl bg-card px-2 py-3" role="radiogroup" aria-label="Colour">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              role="radio"
              aria-checked={look.color === c}
              aria-label={c}
              onClick={() => onPick({ ...look, color: c })}
              className={cn(
                "flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-card transition-transform active:scale-90",
                look.color === c ? "scale-110 ring-3 ring-heading" : "hover:scale-105",
              )}
              style={{ background: BUDDY_COLORS[c].main }}
            >
              {look.color === c && <CheckIcon className="size-4" style={{ color: BUDDY_COLORS[c].on }} strokeWidth={3} />}
            </button>
          ))}
        </div>
      </section>
      {SLOTS.map(({ slot, title }) => {
        const on = look.wear.find((a) => ACCESSORIES[a] === slot) ?? null;
        const items = (Object.keys(ACCESSORIES) as Accessory[]).filter((a) => ACCESSORIES[a] === slot);
        return (
          <section key={slot} className="px-4 pt-6">
            <h2 className="mb-2 px-1 text-sm font-bold tracking-wide text-muted-foreground uppercase">{title}</h2>
            <div className="grid grid-cols-4 gap-2">
              <Tile label="Nothing" on={on === null} onClick={() => wearIn(slot, null)}>
                <span className="flex size-12 items-center justify-center rounded-2xl border-2 border-dashed border-muted-foreground/30 text-muted-foreground">
                  <BanIcon className="size-5" />
                </span>
              </Tile>
              {items.map((a) => (
                <Tile key={a} label={LABEL[a]} on={on === a} onClick={() => wearIn(slot, a)}>
                  <BuddyFace color={look.color} wear={[a]} className="pointer-events-none size-12" title={LABEL[a]} />
                </Tile>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function Tile({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn("flex flex-col items-center gap-1.5 rounded-2xl px-1 pt-4 pb-2 ring-2 transition active:scale-95", on ? "bg-buddy-soft ring-buddy" : "bg-card ring-transparent")}
    >
      {children}
      <span className="text-xs leading-tight font-semibold text-heading">{label}</span>
    </button>
  );
}

function useLook(start: Look) {
  const [look, setLook] = useState<Look>(start);
  const [tries, setTries] = useState(0);
  const pick = (l: Look) => {
    setLook(l);
    setTries((n) => n + 1);
  };
  return { look, tries, pick };
}

function SaveBar({ disabled, onClick, label }: { disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <div className="fixed inset-x-0 bottom-0 flex justify-center bg-background/80 px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] backdrop-blur">
      <Button type="button" size="lg" className="h-12 w-full max-w-sm rounded-2xl text-base font-semibold" disabled={disabled} onClick={onClick}>
        <CheckIcon className="size-5" />
        {label}
      </Button>
    </div>
  );
}

/** The page the home screen's paint button opens: saves the new look straight away. */
export function Wardrobe({ buddy, onSave, onBack }: { buddy: Buddy; onSave: (look: Look) => void; onBack: () => void }) {
  const start = { color: buddy.color, wear: buddy.wear };
  const { look, tries, pick } = useLook(start);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col pb-32" style={buddyVars(look.color)}>
      <TopBar title={`Dress up ${buddy.name}`} onBack={onBack} />
      <Preview look={look} tries={tries} name={buddy.name} main={buddy.main} />
      <LookPicker look={look} name={buddy.name} onPick={pick} />
      <SaveBar disabled={sameLook(look, start)} onClick={() => onSave(look)} label="Looking good!" />
    </main>
  );
}

/** The same, over the buddy maker: the look is kept with the rest of the buddy when it's saved. */
export function LookSheet({ start, name, onDone, onClose }: { start: Look; name: string; onDone: (look: Look) => void; onClose: () => void }) {
  const { look, tries, pick } = useLook(start);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background animate-in fade-in slide-in-from-bottom-6 duration-300" style={buddyVars(look.color)} role="dialog" aria-modal aria-label={`Change how ${name} looks`}>
      <div className="mx-auto flex max-w-md flex-col pb-32">
        <TopBar title={`Dress up ${name}`} onBack={onClose} />
        <Preview look={look} tries={tries} name={name} />
        <LookPicker look={look} name={name} onPick={pick} />
        <SaveBar onClick={() => onDone(look)} label="Done" />
      </div>
    </div>
  );
}
