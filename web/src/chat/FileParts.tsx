// How a buddy's files look: thumbnails for photos, a page icon for text. Shared by the child's app and the parent's
// view; each says where file bytes come from through FileSourceContext (the child's device fetches with its token,
// the parent's browser sends its session cookie).

import { createContext, useContext, useEffect, useState } from "react";
import { CircleAlertIcon, FileTextIcon, ImageIcon, LoaderCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BuddyFile, FileRef } from "../../../src/shared/protocol";

/** Resolves a file id to a URL an <img> can show, or null if it can't be loaded. */
export const FileSourceContext = createContext<(id: number) => Promise<string | null>>(async () => null);

function useFileUrl(id: number, enabled: boolean): string | null {
  const source = useContext(FileSourceContext);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    source(id).then((u) => live && setUrl(u), () => {});
    return () => {
      live = false;
    };
  }, [id, enabled, source]);
  return url;
}

/** A square preview of a file: the photo itself, or an icon for text. */
export function FileThumb({ file, className }: { file: FileRef | BuddyFile; className?: string }) {
  const status = "status" in file ? file.status : "ready";
  const url = useFileUrl(file.id, file.kind === "image");
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground", className)}>
      {file.kind === "image" ? (
        url ? <img src={url} alt={file.name} className="size-full object-cover" /> : <ImageIcon className="size-1/3" />
      ) : (
        <FileTextIcon className="size-1/3" />
      )}
      {status === "reading" && (
        <span className="absolute inset-0 flex items-center justify-center bg-background/60">
          <LoaderCircleIcon className="size-1/3 animate-spin text-foreground" aria-label="Reading" />
        </span>
      )}
      {status === "failed" && (
        <span className="absolute right-1 bottom-1 rounded-full bg-background p-0.5">
          <CircleAlertIcon className="size-4 text-destructive" aria-label="Couldn't read" />
        </span>
      )}
    </span>
  );
}

/** Files shown with a chat message: photos as thumbnails, text files as chips. */
export function MessageFiles({ files, align = "end" }: { files: FileRef[]; align?: "start" | "end" }) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", align === "end" ? "justify-end" : "justify-start")}>
      {files.map((f) =>
        f.kind === "image" ? (
          <FileThumb key={f.id} file={f} className="size-24 border" />
        ) : (
          <span key={f.id} className="flex max-w-56 items-center gap-1.5 rounded-xl border bg-card px-3 py-2 text-sm">
            <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{f.name}</span>
          </span>
        ),
      )}
    </div>
  );
}
