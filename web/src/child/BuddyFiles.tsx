import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrainIcon, CameraIcon, CheckIcon, FolderOpenIcon, LoaderCircleIcon, Trash2Icon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileThumb } from "@/chat/FileParts";
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
import { FILE_LIMITS, type Buddy, type BuddyFile } from "../../../src/shared/protocol";
import { ACCEPT, clearMemory, deleteFile, getMemory, uploadFile } from "./files";

/** A file on its way to the server: shown straight away, before the server has it. */
export interface Upload {
  key: string;
  name: string;
  /** A local preview of a photo. */
  preview: string | null;
}

/**
 * Buttons to take a photo with the camera or pick photos and text files. Calls onAdded with each new file, and
 * onUploading with what's still on its way, so a page can show it at once.
 */
export function AddFiles({
  buddy,
  onAdded,
  onUploading,
  onError,
  compact,
}: {
  buddy: Buddy;
  onAdded?: (f: BuddyFile) => void;
  onUploading?: (u: Upload[]) => void;
  /** Called with each upload that fails. When set, the page shows errors itself. */
  onError?: (message: string) => void;
  compact?: boolean;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState("");
  useEffect(() => onUploading?.(uploads), [uploads, onUploading]);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(""), 4000);
    return () => clearTimeout(t);
  }, [done]);

  const add = async (files: File[]) => {
    setErrors([]);
    setDone("");
    const queued = files.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name || "Photo", preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null, file: f }));
    setUploads((u) => [...u, ...queued.map(({ file: _f, ...rest }) => rest)]);
    for (const q of queued) {
      try {
        const added = await uploadFile(buddy.id, q.file);
        onAdded?.(added);
        setDone(`Added ${added.name}${added.kind === "image" ? `. ${buddy.name} is reading it.` : "."}`);
      } catch (e) {
        if (onError) onError((e as Error).message);
        else setErrors((x) => [...x, `${q.name}: ${(e as Error).message}`]);
      } finally {
        // The splash may still be showing the preview for a moment, so let it go a little later.
        if (q.preview) setTimeout(() => URL.revokeObjectURL(q.preview!), 10_000);
        setUploads((u) => u.filter((x) => x.key !== q.key));
      }
    }
  };
  // Copy the chosen files before clearing the input, so the same photo can be picked again.
  const picked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) void add(files);
  };
  const busy = uploads.length > 0;
  return (
    <div className="flex flex-col gap-2">
      <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2")}>
        <Button type="button" variant="secondary" className="h-12 rounded-2xl font-semibold" onClick={() => camera.current?.click()} disabled={busy}>
          <CameraIcon className="size-5" /> Take a photo
        </Button>
        <Button type="button" variant="secondary" className="h-12 rounded-2xl font-semibold" onClick={() => picker.current?.click()} disabled={busy}>
          <FolderOpenIcon className="size-5" /> Choose a file
        </Button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={picked} />
      <input ref={picker} type="file" accept={ACCEPT} multiple hidden onChange={picked} />
      {busy && !onUploading && (
        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-buddy-strong" role="status">
          <LoaderCircleIcon className="size-4 animate-spin" /> Sending {uploads.length > 1 ? `${uploads.length} files` : "it"} to {buddy.name}…
        </p>
      )}
      {done && !busy && !onUploading && (
        <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-mint" role="status">
          <CheckIcon className="size-4" /> {done}
        </p>
      )}
      {errors.length > 0 && (
        <div className="rounded-2xl bg-coral-soft px-4 py-3 text-sm text-coral" role="alert">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/** The chat's paperclip: share files with the next message, or add new ones. */
export function AttachSheet({
  buddy,
  files,
  selected,
  onToggle,
  onClose,
  onManage,
}: {
  buddy: Buddy;
  files: BuddyFile[];
  selected: number[];
  onToggle: (id: number, on?: boolean) => void;
  onClose: () => void;
  /** Open the buddy's file vault. */
  onManage: () => void;
}) {
  const full = selected.length >= FILE_LIMITS.perMessage;
  return (
    <Sheet title={`Show ${buddy.name} something`} onClose={onClose}>
      <AddFiles buddy={buddy} onAdded={(f) => onToggle(f.id, true)} compact />
      {files.length > 0 && (
        <>
          <div className="mt-4 mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground">{buddy.name}'s files</h3>
            <button className="text-sm font-semibold text-buddy-strong" onClick={onManage}>
              See all
            </button>
          </div>
          <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
            {files.map((f) => {
              const on = selected.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onToggle(f.id)}
                  disabled={f.status === "failed" || (!on && full)}
                  aria-pressed={on}
                  className={cn("relative flex flex-col gap-1 rounded-2xl border-2 p-1.5 text-left disabled:opacity-40", on ? "border-buddy bg-buddy-soft" : "border-transparent")}
                >
                  <FileThumb file={f} className="aspect-square w-full" />
                  <span className="truncate px-0.5 text-xs font-semibold">{f.name}</span>
                  {on && (
                    <span className="absolute top-2.5 right-2.5 flex size-6 items-center justify-center rounded-full bg-buddy text-buddy-on">
                      <CheckIcon className="size-4" strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
      <Button className="mt-4 h-12 w-full rounded-2xl bg-buddy font-semibold text-buddy-on hover:bg-buddy/90" onClick={onClose}>
        {selected.length ? `Share ${selected.length} with ${buddy.name}` : "Done"}
      </Button>
    </Sheet>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 animate-in bg-ink/40 fade-in duration-200" aria-label="Close" onClick={onClose} />
      <div className="relative mx-auto w-full max-w-md animate-in rounded-t-[2rem] bg-card px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl slide-in-from-bottom duration-300">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl">{title}</h2>
          <Button variant="ghost" size="icon" className="rounded-full" onClick={onClose} aria-label="Close">
            <XIcon />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** What the buddy remembers from earlier chats, on its page. The child can wipe it. */
export function MemoryCard({ buddy, parentTitle }: { buddy: Buddy; parentTitle: string }) {
  const [memory, setMemory] = useState<{ text: string | null } | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    getMemory(buddy.id).then(setMemory, () => setMemory({ text: null }));
  }, [buddy.id]);
  if (!memory) return null;
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg">
          <BrainIcon className="size-5 text-buddy-strong" /> What {buddy.name} remembers
        </h2>
        <p className="text-sm text-muted-foreground">
          {buddy.name} keeps a few notes so you can pick up where you left off. {parentTitle} can see them too.
        </p>
      </div>
      {memory.text ? (
        <>
          <div className="rounded-2xl border bg-card p-4 text-sm leading-relaxed whitespace-pre-wrap">{memory.text.replace(/^#+\s*/gm, "")}</div>
          <Button variant="ghost" className="self-start text-muted-foreground" onClick={() => setConfirming(true)}>
            <Trash2Icon /> Forget it all
          </Button>
        </>
      ) : (
        <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">Nothing yet. After a few chats, {buddy.name} will remember what you worked on.</p>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make {buddy.name} forget?</AlertDialogTitle>
            <AlertDialogDescription>{buddy.name} will start fresh next time, without these notes.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => clearMemory(buddy.id).then(() => setMemory({ text: null }), () => {})}>
              Forget
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
