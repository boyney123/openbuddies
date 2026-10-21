// Full screen while files go to a buddy: the photo flies up into the buddy, who gulps each one; then the buddy is
// happy (with confetti and a little chime) or, if it didn't work, says what went wrong.

import { useEffect, type CSSProperties } from "react";
import { FileTextIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileThumb } from "@/chat/FileParts";
import { BuddyFace } from "@/components/brand";
import { Button } from "@/components/ui/button";
import type { Buddy, BuddyFile } from "../../../src/shared/protocol";
import { CONFETTI } from "./Hatch";
import { gotIt, whoosh } from "./sounds";

export type Splash =
  | { phase: "sending"; preview: string | null; count: number }
  | { phase: "done"; file: BuddyFile; count: number }
  | { phase: "error"; message: string };

export function UploadSplash({ buddy, splash, onClose }: { buddy: Buddy; splash: Splash; onClose: () => void }) {
  useEffect(() => {
    if (splash.phase === "sending") whoosh();
    if (splash.phase === "done") {
      gotIt();
      const t = setTimeout(onClose, 3200);
      return () => clearTimeout(t);
    }
  }, [splash.phase, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex animate-in flex-col items-center justify-center gap-6 overflow-hidden bg-background/95 px-6 text-center backdrop-blur fade-in duration-200" role="dialog" aria-modal="true" aria-live="polite">
      {splash.phase === "done" && (
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 size-[200vmax] -translate-x-1/2 -translate-y-1/2 animate-[spin_40s_linear_infinite] opacity-50 [mask-image:radial-gradient(circle,black_4%,transparent_22%)]"
          style={{ background: "repeating-conic-gradient(color-mix(in oklab, var(--buddy) 22%, transparent) 0 9deg, transparent 9deg 18deg)" }}
          aria-hidden
        />
      )}

      <div className="relative flex h-72 w-56 flex-col items-center">
        {/* The buddy at the top, gulping each file as it arrives. */}
        <div className={cn("relative z-10", splash.phase === "sending" && "animate-gulp", splash.phase === "done" && "animate-hatch-pop")} style={{ transformOrigin: "50% 80%" }}>
          <BuddyFace
            color={buddy.color}
            wear={buddy.wear}
            mood={splash.phase === "done" ? "happy" : splash.phase === "error" ? "look" : "thinking"}
            motion={splash.phase === "done" ? "hop" : "none"}
            className="size-36"
            title={buddy.name}
            star={buddy.main}
          />
          {splash.phase === "done" && (
            <span className="absolute -right-6 -bottom-2 rotate-12 rounded-2xl bg-card p-1 shadow-lg">
              <FileThumb file={splash.file} className="size-14 rounded-xl" />
            </span>
          )}
        </div>

        {/* The file, flying up from below into the buddy. */}
        {splash.phase === "sending" && (
          <div className="absolute bottom-0 left-1/2 -ml-14 animate-upload-fly">
            <div className="size-28 overflow-hidden rounded-2xl border-4 border-card bg-card shadow-xl">
              {splash.preview ? (
                <img src={splash.preview} alt="" className="size-full object-cover" />
              ) : (
                <span className="flex size-full items-center justify-center bg-buddy-soft text-buddy-strong">
                  <FileTextIcon className="size-12" />
                </span>
              )}
            </div>
          </div>
        )}

        {splash.phase === "done" &&
          CONFETTI.map((c, i) => (
            <span
              key={i}
              className={cn("absolute top-16 left-1/2 animate-confetti", c.shape === 0 ? "size-3 rounded-full" : c.shape === 1 ? "h-2 w-4 rounded-sm" : "size-3 rotate-45 rounded-[2px]")}
              style={{ background: c.color, "--dx": `${c.dx}px`, "--dy": `${c.dy}px`, animationDelay: `${c.delay}ms` } as CSSProperties}
              aria-hidden
            />
          ))}
      </div>

      <div className="relative flex flex-col items-center gap-2">
        {splash.phase === "sending" && (
          <>
            <h2 className="text-2xl">
              Sending {splash.count > 1 ? `${splash.count} files` : "it"} to {buddy.name}…
            </h2>
            <p className="text-muted-foreground">Hold on a moment.</p>
          </>
        )}
        {splash.phase === "done" && (
          <>
            <h2 className="animate-in text-3xl fade-in slide-in-from-bottom-2 duration-300">Got it!</h2>
            <p className="max-w-xs text-muted-foreground">
              {splash.file.kind === "image" ? `${buddy.name} is reading it now. Ask about it in the chat any time.` : `${buddy.name} has your notes. Ask about them in the chat any time.`}
            </p>
            <Button className="mt-3 h-12 rounded-2xl bg-buddy px-10 text-base font-semibold text-buddy-on hover:bg-buddy/90" onClick={onClose}>
              Yay!
            </Button>
          </>
        )}
        {splash.phase === "error" && (
          <>
            <h2 className="text-2xl">Oops, that didn't work</h2>
            <p className="max-w-xs text-muted-foreground">{splash.message}</p>
            <Button className="mt-3 h-12 rounded-2xl bg-buddy px-10 text-base font-semibold text-buddy-on hover:bg-buddy/90" onClick={onClose}>
              OK
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
