import { BellIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { ParentAlert } from "../../../src/shared/protocol";
import { api, fmtDate, navigate, usePoll } from "./api";
import { PageHeader } from "./ParentApp";

export function Alerts({ onRead }: { onRead: () => void }) {
  const [alerts, reload] = usePoll<ParentAlert[]>("/alerts");
  const open = async (a: ParentAlert) => {
    if (!a.readAt) {
      await api(`/alerts/${a.id}/read`, { method: "POST" });
      onRead();
      reload();
    }
    if (a.sessionId) navigate(`/parent/sessions/${a.sessionId}${a.turnId ? `#turn-${a.turnId}` : ""}`);
  };
  return (
    <>
      <PageHeader title="Alerts" />
      {!alerts ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card py-16 text-center">
          <BellIcon className="size-8 text-muted-foreground" />
          <p className="font-semibold">No alerts</p>
          <p className="max-w-sm text-sm text-muted-foreground">You'll get a push notification on your phone if something worrying comes up.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {alerts.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => open(a)}
                className={cn(
                  "flex w-full items-center gap-4 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:bg-secondary/40",
                  !a.readAt && "border-l-4 border-l-coral",
                  a.readAt && "opacity-70",
                )}
              >
                <Badge variant={a.severity === "high" ? "destructive" : "secondary"} className={a.severity === "medium" ? "bg-sunny-soft text-[#9a6200] dark:text-sunny" : ""}>
                  {a.severity}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{a.summary}</div>
                  <div className="text-sm text-muted-foreground">
                    {a.childName} · {fmtDate(a.sentAt)}
                  </div>
                </div>
                <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
