import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BellIcon, LayoutGridIcon, LogOutIcon, MessagesSquareIcon, SmartphoneIcon, UsersIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark, Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ParentAlert } from "../../../src/shared/protocol";
import { Alerts } from "./Alerts";
import { Apps } from "./Apps";
import { api, AuthError, navigate } from "./api";
import { Children } from "./Children";
import { Devices } from "./Devices";
import { BuddyPage, ChildPage, Overview } from "./Overview";
import { Transcript } from "./Transcript";

type Route =
  | { page: "overview" }
  | { page: "child"; id: string }
  | { page: "buddy"; childId: string; buddyId: number }
  | { page: "session"; id: number; turn?: number }
  | { page: "alerts" }
  | { page: "apps" }
  | { page: "devices" }
  | { page: "children" };

function parseRoute(): Route {
  const p = location.pathname.replace(/^\/parent\/?/, "").split("/").map(decodeURIComponent);
  if (p[0] === "sessions" && p[1]) return { page: "session", id: Number(p[1]), turn: location.hash ? Number(location.hash.replace("#turn-", "")) : undefined };
  if (p[0] === "child" && p[1] && p[2] === "buddy" && p[3]) return { page: "buddy", childId: p[1], buddyId: Number(p[3]) };
  if (p[0] === "child" && p[1]) return { page: "child", id: p[1] };
  if (p[0] === "alerts") return { page: "alerts" };
  if (p[0] === "apps") return { page: "apps" };
  if (p[0] === "devices") return { page: "devices" };
  if (p[0] === "children") return { page: "children" };
  return { page: "overview" };
}

export interface Me {
  parentName: string;
  children: { id: string; name: string }[];
}

export function ParentApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [route, setRoute] = useState<Route>(parseRoute);
  const [unread, setUnread] = useState(0);

  const load = useCallback(() => {
    api<Me>("/me").then(
      (m) => {
        setMe(m);
        setNeedLogin(false);
      },
      (e) => e instanceof AuthError && setNeedLogin(true),
    );
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    const on = () => setRoute(parseRoute());
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  useEffect(() => {
    if (!me) return;
    const poll = () => api<ParentAlert[]>("/alerts").then((a) => setUnread(a.filter((x) => !x.readAt).length), () => {});
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [me]);

  if (needLogin) return <Login onDone={load} />;
  if (!me) return <div className="grid min-h-dvh place-items-center text-muted-foreground">Loading…</div>;

  const nav: { path: string; label: string; icon: LucideIcon; active: boolean; badge?: number }[] = [
    { path: "/parent", label: "Sessions", icon: MessagesSquareIcon, active: ["overview", "child", "buddy", "session"].includes(route.page) },
    { path: "/parent/alerts", label: "Alerts", icon: BellIcon, active: route.page === "alerts", badge: unread },
    { path: "/parent/children", label: "Children", icon: UsersIcon, active: route.page === "children" },
    { path: "/parent/apps", label: "Apps", icon: LayoutGridIcon, active: route.page === "apps" },
    { path: "/parent/devices", label: "Devices", icon: SmartphoneIcon, active: route.page === "devices" },
  ];

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[224px_1fr]">
      <aside className="flex flex-col gap-1 border-b bg-muted/40 px-3 py-4 md:sticky md:top-0 md:h-dvh md:border-r md:border-b-0">
        <div className="mb-5 flex items-center gap-2 px-2">
          <LogoMark className="w-7" />
          <Wordmark className="text-lg" />
          <span className="ml-auto rounded-md border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Parent</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {nav.map((n) => (
            <a
              key={n.path}
              href={n.path}
              onClick={(e) => {
                e.preventDefault();
                navigate(n.path);
              }}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                n.active ? "bg-card text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
              )}
            >
              <n.icon className="size-4" />
              <span className="flex-1">{n.label}</span>
              {n.badge ? <span className="rounded-md bg-coral px-1.5 text-xs font-semibold text-white">{n.badge}</span> : null}
            </a>
          ))}
        </nav>
        <div className="mt-auto hidden items-center justify-between px-2 pt-4 text-sm text-muted-foreground md:flex">
          <span className="truncate">{me.parentName}</span>
          <Button variant="ghost" size="sm" onClick={() => api("/logout", { method: "POST" }).finally(() => setNeedLogin(true))}>
            <LogOutIcon /> Log out
          </Button>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-10 md:py-8">
        {route.page === "overview" && <Overview parentName={me.parentName} />}
        {route.page === "child" && <ChildPage id={route.id} />}
        {route.page === "buddy" && <BuddyPage childId={route.childId} buddyId={route.buddyId} />}
        {route.page === "session" && <Transcript id={route.id} focusTurn={route.turn} />}
        {route.page === "alerts" && <Alerts onRead={() => setUnread((n) => Math.max(0, n - 1))} />}
        {route.page === "children" && <Children onChanged={load} />}
        {route.page === "apps" && <Apps />}
        {route.page === "devices" && <Devices kids={me.children} />}
      </main>
    </div>
  );
}

export function PageHeader({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-center gap-3">
      <h1 className="flex-1 text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </header>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api("/login", { method: "POST", body: JSON.stringify({ pin }) });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setPin("");
    }
  };
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col items-center gap-4 rounded-xl border bg-card p-8 shadow-sm">
        <LogoMark className="w-10" />
        <div className="text-center">
          <Wordmark className="text-xl" />
          <p className="mt-1 text-sm text-muted-foreground">Enter your PIN to continue</p>
        </div>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          placeholder="PIN"
          value={pin}
          autoFocus
          aria-invalid={!!error}
          className="h-12 text-center text-2xl tracking-[0.5em]"
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
        />
        <Button type="submit" size="lg" className="h-10 w-full font-medium" disabled={pin.length < 4}>
          Unlock
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </div>
  );
}
