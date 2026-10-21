// "Add to home screen". Chromium browsers fire beforeinstallprompt (HTTPS only), which we keep and replay when the
// child taps Install: browsers only show the dialog in response to a tap. iOS Safari has no install API at all.

import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Call once at startup, before React renders, so an early event isn't missed. */
export function captureInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export type InstallState = "installed" | "prompt" | "ios" | "unavailable";

export function useInstall(): { state: InstallState; install: () => Promise<boolean> } {
  const read = (): InstallState => (isStandalone() ? "installed" : deferred ? "prompt" : isIos() ? "ios" : "unavailable");
  const [state, setState] = useState<InstallState>(read);
  useEffect(() => {
    const on = () => setState(read());
    listeners.add(on);
    return () => void listeners.delete(on);
  }, []);
  const install = async () => {
    if (!deferred) return false;
    const e = deferred;
    deferred = null;
    await e.prompt();
    const { outcome } = await e.userChoice;
    notify();
    return outcome === "accepted";
  };
  return { state, install };
}
