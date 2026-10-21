// Reminders as notifications on this device (Web Push). Browsers only allow it over HTTPS (OpenBuddies gets that from
// Tailscale Serve); on an iPhone or iPad, only once OpenBuddies is added to the Home Screen. Without it, reminders still
// show in the chat and on the home screen.

import { useCallback, useEffect, useState } from "react";
import { childFetch } from "./files";

export type PushState = "checking" | "needs-https" | "needs-install" | "unsupported" | "blocked" | "off" | "on";

const isAppleMobile = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

async function currentState(): Promise<PushState> {
  if (!window.isSecureContext) return "needs-https";
  if (isAppleMobile() && !isInstalled()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return "off";
  // Tell the server again, in case it was lost (a re-paired device, a reset household).
  const { subscribed } = await (await childFetch("/push")).json();
  if (!subscribed) await save(sub);
  return "on";
}

function keyBytes(base64url: string): Uint8Array {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function save(sub: PushSubscription) {
  await childFetch("/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
}

/** Whether this device gets reminders as notifications, and a way to turn them on or off. */
export function usePush() {
  const [state, setState] = useState<PushState>("checking");
  const [error, setError] = useState("");
  useEffect(() => {
    currentState().then(setState, () => setState("unsupported"));
  }, []);

  const enable = useCallback(async () => {
    setError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");
      const { publicKey } = await (await childFetch("/push")).json();
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
      await save(sub);
      setState("on");
    } catch (e) {
      setError((e as Error).message || "Couldn't turn on reminders.");
    }
  }, []);

  const disable = useCallback(async () => {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) {
      await childFetch("/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }
    setState("off");
  }, []);

  return { state, error, enable, disable };
}
