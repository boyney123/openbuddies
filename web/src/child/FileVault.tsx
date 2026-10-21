// A buddy's file vault: everything the child keeps with that buddy (homework photos, notes), to add to, search,
// look at, rename and remove. In the chat the buddy finds the right one when the child mentions it ("check my history
// homework"), so the vault is where files go in, and the chat is where they're used.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileTextIcon, FolderOpenIcon, ImageIcon, LoaderCircleIcon, MessageCircleIcon, PencilIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileThumb } from "@/chat/FileParts";
import { FolderArt } from "@/components/brand";
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
import { Input } from "@/components/ui/input";
import { FILE_LIMITS, type Buddy, type BuddyFile } from "../../../src/shared/protocol";
import { AddFiles, type Upload } from "./BuddyFiles";
import { deleteFile, fileText, fileUrl, renameFile } from "./files";
import { TopBar } from "./TopBar";
import { UploadSplash, type Splash } from "./UploadSplash";

type Filter = "all" | "image" | "text";

/** How long the "sending" animation shows at the least: two trips of the file into the buddy. */
const SENDING_AT_LEAST_MS = 2600;

function fmtAdded(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The vault, as a page of its own. */
export function FileVault({ buddy, files: fromServer, parentTitle, onBack, onChat }: { buddy: Buddy; files: BuddyFile[]; parentTitle: string; onBack: () => void; onChat: (fileId: number) => void }) {
  // New files show as soon as the upload returns, without waiting for the server's update to arrive.
  const [added, setAdded] = useState<BuddyFile[]>([]);
  const [uploading, setUploading] = useState<Upload[]>([]);
  const files = useMemo(() => [...added.filter((a) => !fromServer.some((f) => f.id === a.id)).reverse(), ...fromServer], [added, fromServer]);
  // The full-screen splash: sending, then "Got it!" or what went wrong.
  const [splash, setSplash] = useState<Splash | null>(null);
  const finished = useRef<{ file: BuddyFile | null; error: string; count: number }>({ file: null, error: "", count: 0 });
  const onAdded = useCallback((f: BuddyFile) => {
    setAdded((a) => [...a, f]);
    finished.current.file = f;
    finished.current.count++;
  }, []);
  const onError = useCallback((message: string) => (finished.current.error = message), []);
  const sendingSince = useRef(0);
  const onUploading = useCallback((u: Upload[]) => {
    setUploading(u);
    if (u.length) {
      setSplash((s) => {
        if (s?.phase !== "sending") sendingSince.current = Date.now();
        return { phase: "sending", preview: u[0].preview, count: s?.phase === "sending" ? Math.max(s.count, u.length) : u.length };
      });
      return;
    }
    const { file, error, count } = finished.current;
    finished.current = { file: null, error: "", count: 0 };
    // Let the file be seen flying to the buddy (a couple of trips) before it says "Got it!", however fast the upload was.
    const wait = Math.max(0, SENDING_AT_LEAST_MS - (Date.now() - sendingSince.current));
    setTimeout(() => setSplash((s) => (s?.phase !== "sending" ? s : error ? { phase: "error", message: error } : file ? { phase: "done", file, count } : null)), wait);
  }, []);
  const closeSplash = useCallback(() => setSplash(null), []);
  // Once the server's list has a file, it's the one to go by (so a removed file doesn't come back).
  useEffect(() => setAdded((a) => (a.some((x) => fromServer.some((f) => f.id === x.id)) ? a.filter((x) => !fromServer.some((f) => f.id === x.id)) : a)), [fromServer]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<BuddyFile | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => (filter === "all" || f.kind === filter) && (!q || `${f.name} ${f.summary ?? ""}`.toLowerCase().includes(q)));
  }, [files, query, filter]);
  // Keep the open file's details fresh as it's read or renamed.
  const current = open && (files.find((f) => f.id === open.id) ?? null);
  const counts = { all: files.length, image: files.filter((f) => f.kind === "image").length, text: files.filter((f) => f.kind === "text").length };

  return (
    <main className="mx-auto min-h-dvh max-w-md pb-[max(24px,env(safe-area-inset-bottom))]">
      <TopBar title={`${buddy.name}'s files`} onBack={onBack} />
      <div className="flex flex-col gap-4 px-4 pt-1">
        <section className="flex items-center gap-3 rounded-3xl bg-buddy-soft p-4">
          <FolderArt className="w-24 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-heading">
              {files.length} file{files.length === 1 ? "" : "s"}
              <span className="font-normal text-muted-foreground"> of {FILE_LIMITS.perBuddy}</span>
            </p>
            <p className="text-sm leading-snug text-muted-foreground">
              Just mention one in the chat, like <span className="font-semibold text-foreground">"check my history homework"</span>, and {buddy.name} will find it.
            </p>
          </div>
        </section>

        {files.length < FILE_LIMITS.perBuddy ? (
          <AddFiles buddy={buddy} onAdded={onAdded} onUploading={onUploading} onError={onError} />
        ) : (
          <p className="text-center text-sm text-muted-foreground">That's {FILE_LIMITS.perBuddy} files! Remove one to add another.</p>
        )}

        {files.length > 0 && (
          <>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your files" className="h-12 rounded-2xl bg-card pl-10 text-base" aria-label="Search your files" />
              {query && (
                <button className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-muted-foreground" onClick={() => setQuery("")} aria-label="Clear search">
                  <XIcon className="size-4" />
                </button>
              )}
            </div>
            <div className="flex gap-2" role="tablist" aria-label="Show">
              {(
                [
                  ["all", "All", FolderOpenIcon],
                  ["image", "Photos", ImageIcon],
                  ["text", "Notes", FileTextIcon],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={filter === key}
                  onClick={() => setFilter(key)}
                  className={cn("flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors", filter === key ? "bg-buddy text-buddy-on" : "bg-card text-muted-foreground")}
                >
                  <Icon className="size-4" /> {label} <span className="opacity-70">{counts[key]}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {uploading.length > 0 && (
          <ul className="grid grid-cols-2 gap-3" aria-label="Sending">
            {uploading.map((u) => (
              <li key={u.key} className="flex flex-col gap-2 rounded-3xl border-2 border-dashed border-buddy/40 bg-card p-2">
                <span className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl bg-muted">
                  {u.preview ? <img src={u.preview} alt="" className="size-full object-cover opacity-60" /> : <FileTextIcon className="size-8 text-muted-foreground" />}
                  <LoaderCircleIcon className="absolute size-8 animate-spin text-buddy-strong" />
                </span>
                <span className="truncate px-1 pb-1 text-sm font-semibold text-muted-foreground">Sending…</span>
              </li>
            ))}
          </ul>
        )}

        {files.length === 0 && uploading.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed px-5 py-8 text-center">
            <FolderArt className="w-32 opacity-90" />
            <p className="text-muted-foreground">Nothing here yet. Snap a photo of your homework or add your notes, and {buddy.name} can help with them any time.</p>
          </div>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">No files match "{query}".</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {shown.map((f) => (
              <li key={f.id}>
                <button onClick={() => setOpen(f)} className="flex w-full flex-col gap-2 rounded-3xl border bg-card p-2 text-left transition-transform active:scale-[0.98]">
                  <FileThumb file={f} className="aspect-[4/3] w-full rounded-2xl" />
                  <span className="min-w-0 px-1 pb-1">
                    <span className="block truncate text-sm font-bold text-heading">{f.name}</span>
                    <span className={cn("line-clamp-2 text-xs leading-snug", f.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                      {f.status === "reading" ? `${buddy.name} is reading it…` : f.status === "failed" ? "Couldn't read this one" : (f.summary ?? (f.kind === "image" ? "Photo" : "Notes"))}
                    </span>
                    <span className="mt-1 block text-[11px] font-semibold text-buddy-strong">{fmtAdded(f.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-center text-xs text-muted-foreground">{parentTitle} can see these files too.</p>
      </div>
      {splash && <UploadSplash buddy={buddy} splash={splash} onClose={closeSplash} />}
      {current && <FileViewer buddy={buddy} file={current} onClose={() => setOpen(null)} onChat={onChat} onRemoved={(id) => setAdded((a) => a.filter((x) => x.id !== id))} />}
    </main>
  );
}

/** One file, full screen: the photo or the notes, with rename and remove. */
function FileViewer({ buddy, file, onClose, onChat, onRemoved }: { buddy: Buddy; file: BuddyFile; onClose: () => void; onChat: (fileId: number) => void; onRemoved: (id: number) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (file.kind === "image") fileUrl(file.id).then(setUrl);
    else fileText(file.id).then(setText, () => setText(""));
  }, [file.id, file.kind]);
  const save = async () => {
    if (!name?.trim()) return setName(null);
    setError("");
    try {
      await renameFile(file.id, name.trim());
      setName(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label={file.name}>
      <div className="flex items-center gap-2 px-3 pt-[max(12px,env(safe-area-inset-top))] pb-2">
        <Button variant="ghost" size="icon" className="rounded-full" onClick={onClose} aria-label="Close">
          <XIcon />
        </Button>
        {name === null ? (
          <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setName(file.name.replace(/\.[^.]+$/, ""))} aria-label="Rename">
            <span className="truncate text-lg font-bold text-heading">{file.name}</span>
            <PencilIcon className="size-4 shrink-0 text-muted-foreground" />
          </button>
        ) : (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Input value={name} autoFocus maxLength={FILE_LIMITS.nameLength} onChange={(e) => setName(e.target.value)} className="h-10 rounded-xl" aria-label="New name" />
            <Button type="submit" size="sm" className="h-10 rounded-xl bg-buddy text-buddy-on hover:bg-buddy/90">
              Save
            </Button>
          </form>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4">
        {file.kind === "image" ? (
          url ? (
            <img src={url} alt={file.summary ?? file.name} className="mx-auto max-h-full rounded-2xl object-contain" />
          ) : (
            <p className="py-10 text-center text-muted-foreground">Loading…</p>
          )
        ) : (
          <pre className="rounded-2xl bg-card p-4 font-sans text-[15px] leading-relaxed whitespace-pre-wrap">{text ?? "Loading…"}</pre>
        )}
      </div>
      <div className="flex flex-col gap-2 px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
        {file.summary && <p className="text-sm text-muted-foreground">{file.summary}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button className="h-12 flex-1 rounded-2xl bg-buddy font-semibold text-buddy-on hover:bg-buddy/90" onClick={() => onChat(file.id)}>
            <MessageCircleIcon /> Ask {buddy.name} about it
          </Button>
          <Button variant="secondary" size="icon" className="size-12 rounded-2xl text-muted-foreground hover:text-destructive" onClick={() => setRemoving(true)} aria-label={`Remove ${file.name}`}>
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {file.name}?</AlertDialogTitle>
            <AlertDialogDescription>{buddy.name} won't be able to look at it any more.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleteFile(file.id).then(() => (onRemoved(file.id), onClose()), () => {})}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
