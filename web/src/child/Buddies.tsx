import { useEffect, useState } from "react";
import { ChevronRightIcon, FolderOpenIcon, PencilIcon, PlusIcon, StarIcon, Trash2Icon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BuddyFace, buddyVars } from "@/components/brand";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { MAX_BUDDIES, type Buddy, type BuddyFile, type BuddyInput, type SubjectOption } from "../../../src/shared/protocol";
import { MemoryCard } from "./BuddyFiles";
import { BuddyMaker } from "./BuddyMaker";

/** Which buddy the pointer (or keyboard focus) is on, so its face can light up. */
function useHovered() {
  const [hovered, setHovered] = useState<number | null>(null);
  const leave = () => setHovered(null);
  const hoverProps = (id: number) => ({ onPointerEnter: () => setHovered(id), onPointerLeave: leave, onFocus: () => setHovered(id), onBlur: leave });
  return { hovered, hoverProps };
}

/** A buddy's face that smiles, and hops when its card is hovered or focused (the card has the `group` class). */
function HoppingFace({ buddy, happy, className }: { buddy: Buddy; happy: boolean; className?: string }) {
  return (
    <span className="block shrink-0 origin-bottom group-hover:animate-hop-loop group-focus-visible:animate-hop-loop">
      <BuddyFace color={buddy.color} wear={buddy.wear} mood={happy ? "happy" : "idle"} className={className} title={buddy.name} star={buddy.main} />
    </span>
  );
}

export function subjectName(subjects: SubjectOption[], subject: string | null): string | null {
  return subject ? (subjects.find((s) => s.name === subject)?.label ?? null) : null;
}

/** All the child's buddies: tap one to talk to it, or make a new one. */
export function BuddyList({
  buddies,
  activeId,
  subjects,
  onPick,
  onEdit,
  onNew,
}: {
  buddies: Buddy[];
  activeId: number | null;
  subjects: SubjectOption[];
  onPick: (b: Buddy) => void;
  onEdit: (b: Buddy) => void;
  onNew: () => void;
}) {
  const full = buddies.length >= MAX_BUDDIES;
  const { hovered, hoverProps } = useHovered();
  return (
    <div className="flex flex-col gap-3 px-4 py-5">
      <p className="px-1 text-sm text-muted-foreground">Tap a buddy to talk to them. Each buddy keeps its own chat.</p>
      {buddies.map((b) => {
        const subject = subjectName(subjects, b.subject);
        const active = b.id === activeId;
        return (
          <div
            key={b.id}
            style={buddyVars(b.color)}
            className={`flex items-center gap-1 rounded-3xl border bg-card pr-2 transition-colors ${active ? "border-buddy ring-2 ring-buddy/30" : ""}`}
          >
            <button onClick={() => onPick(b)} {...hoverProps(b.id)} className="group flex min-w-0 flex-1 items-center gap-3 rounded-3xl p-3 text-left active:scale-[0.99]">
              <HoppingFace buddy={b} happy={active || hovered === b.id} className="size-14" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-base font-bold text-heading">{b.name}</span>
                  {b.main && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-sunny-soft px-2 py-0.5 text-[11px] font-semibold text-foreground">
                      <StarIcon className="size-3 fill-sunny text-sunny" /> Main
                    </span>
                  )}
                  {subject && <span className="rounded-full bg-buddy-soft px-2 py-0.5 text-[11px] font-semibold text-foreground dark:bg-buddy/25">{subject}</span>}
                </span>
                <span className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{b.description || (active ? "Talking now" : "Ready to help")}</span>
              </span>
            </button>
            <Button variant="ghost" size="icon" className="shrink-0 rounded-xl" onClick={() => onEdit(b)} aria-label={`Change ${b.name}`}>
              <PencilIcon />
            </Button>
          </div>
        );
      })}
      <Button size="lg" variant="secondary" className="mt-2 h-12 rounded-2xl text-base font-semibold" disabled={full} onClick={onNew}>
        <PlusIcon className="size-5" /> Make a new buddy
      </Button>
      {full && <p className="text-center text-sm text-muted-foreground">That's {MAX_BUDDIES} buddies! Remove one to make another.</p>}
    </div>
  );
}

/** Change a buddy. Any buddy except the main one can be removed. */
export function BuddyEditor({
  buddy,
  subjects,
  parentTitle,
  files,
  onSave,
  onRemove,
  onOpenFiles,
}: {
  buddy: Buddy;
  subjects: SubjectOption[];
  parentTitle: string;
  files: BuddyFile[];
  onSave: (b: BuddyInput) => void;
  onRemove: () => void;
  /** Open the buddy's file vault. */
  onOpenFiles: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-col gap-6 px-6 py-8">
      <BuddyMaker key={buddy.id} initial={buddy} subjects={subjects} saveLabel={() => "Save"} onSave={onSave} />
      <button onClick={onOpenFiles} className="flex items-center gap-4 rounded-3xl bg-buddy-soft p-4 text-left transition-transform active:scale-[0.98]">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-buddy text-buddy-on">
          <FolderOpenIcon className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-bold text-heading">{buddy.name}'s files</span>
          <span className="block text-sm text-muted-foreground">
            {files.length ? `${files.length} file${files.length === 1 ? "" : "s"}: homework photos and notes` : "Add homework photos and notes"}
          </span>
        </span>
        <ChevronRightIcon className="size-5 shrink-0 text-buddy-strong" />
      </button>
      <MemoryCard buddy={buddy} parentTitle={parentTitle} />
      {buddy.main ? (
        <p className="text-center text-sm text-muted-foreground">{buddy.name} is your main buddy, so they're here to stay.</p>
      ) : (
        <Button variant="ghost" className="mx-auto text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
          <Trash2Icon /> Remove {buddy.name}
        </Button>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {buddy.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {buddy.name} won't be in your buddies any more, and {buddy.name}'s files are deleted. Your chats with {buddy.name} are still saved for {parentTitle}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep {buddy.name}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onRemove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A bottom sheet for switching buddy in one tap, or making a new one. */
export function BuddySheet({
  buddies,
  activeId,
  subjects,
  onPick,
  onNew,
  onManage,
  onClose,
}: {
  buddies: Buddy[];
  activeId: number | null;
  subjects: SubjectOption[];
  onPick: (b: Buddy) => void;
  onNew: () => void;
  onManage: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const full = buddies.length >= MAX_BUDDIES;
  const { hovered, hoverProps } = useHovered();
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Switch buddy">
      <button className="absolute inset-0 animate-in bg-ink/40 fade-in duration-200" aria-label="Close" onClick={onClose} />
      <div className="relative mx-auto w-full max-w-md animate-in rounded-t-[2rem] bg-card px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl slide-in-from-bottom duration-300">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl">Who do you want to work with?</h2>
          <Button variant="ghost" size="icon" className="rounded-full" onClick={onClose} aria-label="Close">
            <XIcon />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {buddies.map((b) => {
            const active = b.id === activeId;
            const lively = active || hovered === b.id;
            const subject = subjectName(subjects, b.subject);
            return (
              <button
                key={b.id}
                style={buddyVars(b.color)}
                onClick={() => onPick(b)}
                {...hoverProps(b.id)}
                aria-pressed={active}
                className={cn(
                  "group flex min-w-0 flex-col items-center gap-1 rounded-3xl border-2 p-3 transition-[transform,background-color] duration-200 hover:-translate-y-1 focus-visible:-translate-y-1 active:scale-95",
                  active ? "border-buddy bg-buddy-soft" : "border-transparent bg-muted/60 hover:bg-muted",
                )}
              >
                <HoppingFace buddy={b} happy={lively} className="size-14" />
                <span className="flex max-w-full items-center gap-0.5 text-sm font-bold text-heading">
                  {b.main && <StarIcon className="size-3 shrink-0 fill-sunny text-sunny" aria-label="Main buddy" />}
                  <span className="truncate">{b.name}</span>
                </span>
                <span className="h-4 max-w-full truncate text-[11px] text-muted-foreground">{subject ?? (active ? "Talking now" : "")}</span>
              </button>
            );
          })}
          {!full && (
            <button
              onClick={onNew}
              className="group flex flex-col items-center justify-center gap-1 rounded-3xl border-2 border-dashed p-3 text-muted-foreground transition-[transform,background-color] duration-200 hover:-translate-y-1 hover:bg-muted/60 focus-visible:-translate-y-1 active:scale-95"
            >
              <span className="flex size-14 items-center justify-center rounded-2xl bg-muted transition-colors group-hover:bg-buddy-soft group-hover:text-buddy-strong">
                <PlusIcon className="size-7 transition-transform duration-300 group-hover:rotate-90" />
              </span>
              <span className="text-sm font-bold">New buddy</span>
              <span className="h-4" />
            </button>
          )}
        </div>
        <Button variant="ghost" className="mt-4 w-full rounded-2xl" onClick={onManage}>
          <PencilIcon /> Change or remove buddies
        </Button>
      </div>
    </div>
  );
}
