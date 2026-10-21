import { useCallback, useEffect, useState } from "react";

export class AuthError extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/parent${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (res.status === 401) throw new AuthError("login required");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export function navigate(path: string) {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Fetch now and every `ms` while mounted. */
export function usePoll<T>(path: string, ms = 5000): [T | null, () => void, string] {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api<T>(path).then(
      (d) => {
        setData(d);
        setError("");
      },
      (e) => setError(e.message),
    );
  }, [path]);
  useEffect(() => {
    load();
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [load, ms]);
  return [data, load, error];
}

export const fmtDate = (s: string) => new Date(s).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtTime = (s: string) => new Date(s).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
export const ago = (s: string | null) => {
  if (!s) return "never";
  const m = Math.round((Date.now() - Date.parse(s)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
export const fmtMinutes = (m: number) => (m < 1 ? "0 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);
