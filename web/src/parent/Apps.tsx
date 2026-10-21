// The parent's apps: what each child has, the gallery to add more from, and catalogues of other people's apps. Adding
// an app shows it in full first (what it uses and everything it tells the buddy); it's only on for the children the
// parent picks.

import { useState } from "react";
import { BookOpenIcon, LinkIcon, PackageIcon, PlusIcon, ShieldCheckIcon, Trash2Icon, XIcon } from "lucide-react";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, usePoll } from "./api";
import { PageTitle } from "./Overview";

interface AppView {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  kind: "tutor" | "studio";
  needs: string[];
  source: "builtin" | "installed" | "local";
  origin: string | null;
  icon: string;
  children: { id: string; name: string; on: boolean }[];
}

interface GalleryEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  catalogue: string;
  source: string;
  installed: boolean;
}

interface Preview {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  kind: "tutor" | "studio";
  needs: string[];
  skill: string;
  origin: string;
  sha256: string;
  installed: boolean;
}

const NEEDS: Record<string, string> = {
  hint_ladder: "Hints, step by step",
  files: "The child's files",
  web: "Looking things up online",
  reminders: "Reminders",
  pictures: "Making pictures",
};

const SOURCE: Record<AppView["source"], string> = { builtin: "Comes with OpenBuddies", installed: "Added", local: "Your own" };

export function Apps() {
  const [data, reload] = usePoll<{ apps: AppView[]; gallery: GalleryEntry[]; catalogues: string[] }>("/apps", 30_000);
  const [preview, setPreview] = useState<{ source: string; app: Preview } | null>(null);
  const [error, setError] = useState("");
  const call = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const open = (source: string) =>
    call(async () => setPreview({ source, app: await api<Preview>("/apps/preview", { method: "POST", body: JSON.stringify({ source }) }) }));

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const toAdd = data.gallery.filter((g) => !g.installed);
  return (
    <>
      <PageTitle title="Apps" sub="What each child has on their home screen. Every app follows OpenBuddies' rules: no answers, welfare alerts, their help level and allowance." />
      {error && <p className="mb-4 rounded-lg bg-coral-soft px-4 py-2 text-sm text-[#c2352a]">{error}</p>}

      <div className="overflow-hidden rounded-xl border">
        <ul className="divide-y">
          {data.apps.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <AppIcon name={a.icon} className="size-5 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-heading">{a.name}</span>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{SOURCE[a.source]}</span>
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {a.description} {a.source !== "builtin" && <span className="text-xs">· {a.author}, v{a.version}</span>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {a.children.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={c.on}
                      onChange={(e) => call(() => api(`/children/${c.id}/apps/${a.id}`, { method: "PUT", body: JSON.stringify({ on: e.target.checked }) }))}
                    />
                    {c.name}
                  </label>
                ))}
                {a.source !== "builtin" && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => confirm(`Remove ${a.name}? Children's chats in it stay in Sessions.`) && call(() => api(`/apps/${a.id}`, { method: "DELETE" }))}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <section className="mt-8">
        <h2 className="mb-1 text-base font-semibold">Gallery</h2>
        <p className="mb-3 text-sm text-muted-foreground">Apps you can add. You'll see exactly what each one tells the buddy before it's added.</p>
        {toAdd.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">You've added everything in the gallery.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {toAdd.map((g) => (
              <div key={g.source} className="flex flex-col rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <PackageIcon className="size-4 text-muted-foreground" />
                  <span className="font-medium text-heading">{g.name}</span>
                </div>
                <p className="mt-1 flex-1 text-sm text-muted-foreground">{g.description}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">
                    {g.author} · {g.catalogue}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => open(g.source)}>
                    <BookOpenIcon /> Look at it
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Catalogues urls={data.catalogues} onChange={(urls) => call(() => api("/apps/catalogues", { method: "PUT", body: JSON.stringify({ urls }) }))} onLink={open} />

      {preview && (
        <Review
          source={preview.source}
          app={preview.app}
          kids={data.apps[0]?.children ?? []}
          onClose={() => setPreview(null)}
          onAdd={(children) =>
            call(async () => {
              await api("/apps/install", { method: "POST", body: JSON.stringify({ source: preview.source, sha256: preview.app.sha256, children }) });
              setPreview(null);
            })
          }
        />
      )}
    </>
  );
}

/** Other people's app catalogues, and adding a single app by its link. */
function Catalogues({ urls, onChange, onLink }: { urls: string[]; onChange: (urls: string[]) => void; onLink: (source: string) => void }) {
  const [catalogue, setCatalogue] = useState("");
  const [link, setLink] = useState("");
  return (
    <section className="mt-8 grid gap-6 lg:grid-cols-2">
      <div>
        <h2 className="mb-1 text-base font-semibold">Catalogues</h2>
        <p className="mb-3 text-sm text-muted-foreground">Lists of apps other people share (an https link to an index.json). Their apps show in the gallery.</p>
        <ul className="mb-2 flex flex-col gap-1.5">
          {urls.map((u) => (
            <li key={u} className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
              <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{u}</span>
              <button className="rounded p-0.5 text-muted-foreground hover:text-destructive" onClick={() => onChange(urls.filter((x) => x !== u))} aria-label={`Remove ${u}`}>
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (catalogue.trim()) onChange([...urls, catalogue.trim()]);
            setCatalogue("");
          }}
        >
          <Input value={catalogue} onChange={(e) => setCatalogue(e.target.value)} placeholder="https://…/index.json" className="h-9" aria-label="Catalogue link" />
          <Button type="submit" size="sm" variant="outline" disabled={!catalogue.trim()}>
            <PlusIcon /> Add
          </Button>
        </form>
      </div>
      <div>
        <h2 className="mb-1 text-base font-semibold">Add an app by link</h2>
        <p className="mb-3 text-sm text-muted-foreground">Someone sent you an app? Paste its link (a .json app bundle) to look at it.</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim()) onLink(link.trim());
          }}
        >
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/my-app.json" className="h-9" aria-label="App link" />
          <Button type="submit" size="sm" variant="outline" disabled={!link.trim()}>
            Look at it
          </Button>
        </form>
      </div>
    </section>
  );
}

/** Everything an app is, before it's added: what it uses, where it's from, and its instructions in full. */
function Review({ source, app, kids, onClose, onAdd }: { source: string; app: Preview; kids: { id: string; name: string }[]; onClose: () => void; onAdd: (children: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label={`Add ${app.name}`}>
      <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-card shadow-xl">
        <header className="flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">
              {app.name} <span className="text-sm font-normal text-muted-foreground">v{app.version}</span>
            </h2>
            <p className="text-sm text-muted-foreground">
              {app.description} By {app.author}.
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <XIcon />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-[120px_1fr]">
            <dt className="text-muted-foreground">Uses</dt>
            <dd>{app.needs.map((n) => NEEDS[n] ?? n).join(", ") || "Nothing extra"}</dd>
            <dt className="text-muted-foreground">From</dt>
            <dd className="break-all">{source.startsWith("gallery:") ? "OpenBuddies gallery" : app.origin}</dd>
            <dt className="text-muted-foreground">Fingerprint</dt>
            <dd className="font-mono text-xs break-all text-muted-foreground">{app.sha256}</dd>
          </dl>
          <h3 className="mt-5 mb-2 text-sm font-semibold">What it tells the buddy</h3>
          <pre className="max-h-80 overflow-auto rounded-lg bg-muted/60 p-3 font-sans text-sm leading-relaxed whitespace-pre-wrap">{app.skill.trim()}</pre>
          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-mint" /> OpenBuddies' own rules always come first, whatever an app says: no answers to homework, welfare alerts to you, the
            child's help level and allowance.
          </p>
        </div>
        <footer className="flex flex-wrap items-center gap-3 border-t px-5 py-3">
          <span className="text-sm text-muted-foreground">Turn on for</span>
          {kids.map((k) => (
            <label key={k.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={picked.includes(k.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, k.id] : p.filter((x) => x !== k.id)))} />
              {k.name}
            </label>
          ))}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => onAdd(picked)}>{app.installed ? "Update" : "Add"} app</Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
