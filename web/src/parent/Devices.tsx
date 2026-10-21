import { useState } from "react";
import { QrCodeIcon, SmartphoneIcon } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ParentDevice } from "../../../src/shared/protocol";
import { ago, api, fmtDate, usePoll } from "./api";
import { PageHeader } from "./ParentApp";

export function Devices({ kids }: { kids: { id: string; name: string }[] }) {
  const [devices, reload] = usePoll<ParentDevice[]>("/devices");
  const [pairing, setPairing] = useState<{ childId: string; url: string; svg: string } | null>(null);
  const [revoking, setRevoking] = useState<ParentDevice | null>(null);

  const pair = async (childId: string) => setPairing({ childId, ...(await api<{ url: string; svg: string }>("/pair", { method: "POST", body: JSON.stringify({ childId }) })) });
  const revoke = async () => {
    if (!revoking) return;
    await api(`/devices/${revoking.id}/revoke`, { method: "POST" });
    setRevoking(null);
    reload();
  };

  return (
    <>
      <PageHeader title="Devices" />
      <div className="flex flex-col gap-5">
        {kids.map((k) => {
          const list = (devices ?? []).filter((d) => d.childId === k.id);
          return (
            <Card key={k.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg text-heading">{k.name}</CardTitle>
                <Button onClick={() => pair(k.id)}>
                  <QrCodeIcon /> Pair a new device
                </Button>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {pairing?.childId === k.id && (
                  <div className="flex flex-col items-center gap-5 rounded-xl bg-muted/50 p-5 sm:flex-row">
                    <div className="size-48 shrink-0 rounded-xl bg-white p-2 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: pairing.svg }} />
                    <div className="flex flex-col gap-2">
                      <p className="font-semibold">Scan with {k.name}'s phone camera</p>
                      <p className="text-sm text-muted-foreground">The code works once and expires in 10 minutes.</p>
                      <p className="text-xs break-all text-muted-foreground">{pairing.url}</p>
                      <Button variant="ghost" size="sm" className="self-start" onClick={() => setPairing(null)}>
                        Done
                      </Button>
                    </div>
                  </div>
                )}
                {list.length === 0 && <p className="text-sm text-muted-foreground">No devices yet.</p>}
                {list.length > 0 && (
                  <div className="divide-y rounded-xl border">
                    {list.map((d) => (
                      <div key={d.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${d.revokedAt ? "opacity-55" : ""}`}>
                        <SmartphoneIcon className="size-4 text-muted-foreground" />
                        <span className="min-w-28 flex-1 font-semibold">{d.name}</span>
                        <span className="text-sm text-muted-foreground">paired {fmtDate(d.pairedAt)}</span>
                        <span className="w-32 text-sm text-muted-foreground">seen {ago(d.lastSeenAt)}</span>
                        {d.revokedAt ? (
                          <Badge variant="secondary">logged out</Badge>
                        ) : (
                          <Button variant="outline" size="sm" className="text-destructive" onClick={() => setRevoking(d)}>
                            Revoke
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AlertDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log out "{revoking?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>It's logged out immediately and needs a new QR code to pair again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={revoke}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
