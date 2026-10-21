import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";
import { isPrivateLan, isTailscale } from "./auth.js";

const run = promisify(execFile);

function addresses(filter: (ip: string) => boolean): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (!a.internal && a.family === "IPv4" && filter(a.address)) out.push(a.address);
  }
  return out;
}

export const lanAddresses = () => addresses((ip) => isPrivateLan(ip) && !ip.startsWith("169.254."));
export const tailscaleAddresses = () => addresses(isTailscale);

/** Loopback, private LAN and Tailscale addresses. Never 0.0.0.0, so a public interface is never bound. */
export function bindAddresses(extra: string[] = []): string[] {
  return [...new Set(["127.0.0.1", "::1", ...lanAddresses(), ...tailscaleAddresses(), ...extra])];
}

const TAILSCALE_BINS = ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale", "/usr/bin/tailscale"];

/**
 * The tailscale CLI on this machine, or null. Found by looking, not by running it: the macOS app's CLI can hang
 * (for example before it's signed in), so presence is the only reliable "installed" signal.
 */
export function tailscaleBin(): string | null {
  const onPath = (process.env.PATH ?? "").split(delimiter).map((d) => join(d, "tailscale"));
  // The real binaries first: /usr/local/bin/tailscale on macOS is a shell wrapper, and killing it on timeout would
  // leave the app process it started still hanging.
  return [...TAILSCALE_BINS, ...onPath].find((p) => existsSync(p)) ?? null;
}

/** Run the CLI with a hard deadline. A hung call is killed, not waited on. */
async function ts(bin: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run(bin, args, { timeout: 2500, killSignal: "SIGKILL" });
    return stdout;
  } catch {
    return null;
  }
}

export interface TailscaleStatus {
  installed: boolean;
  /** Connected and signed in. */
  running: boolean;
  /** MagicDNS name, e.g. "old-mac.tail1234.ts.net". */
  dnsName: string | null;
  ip: string | null;
  /** Tailscale Serve is proxying HTTPS to this port. */
  serving: boolean;
}

const cache = new Map<string, { at: number; value: Promise<TailscaleStatus> }>();

/** Tailscale's state, cached for 30 seconds. `fresh` skips the cache (used right after changing it). */
export function tailscaleStatus(port?: number, opts: { fresh?: boolean } = {}): Promise<TailscaleStatus> {
  const key = String(port ?? "");
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < 30_000) return hit.value;
  const value = readStatus(port);
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function readStatus(port?: number): Promise<TailscaleStatus> {
  const bin = tailscaleBin();
  if (!bin) return { installed: false, running: false, dnsName: null, ip: null, serving: false };
  let running = false;
  let dnsName: string | null = null;
  let ip: string | null = null;
  const out = await ts(bin, ["status", "--json"]);
  if (out) {
    try {
      const st = JSON.parse(out);
      running = st?.BackendState === "Running";
      dnsName = String(st?.Self?.DNSName ?? "").replace(/\.$/, "") || null;
      ip = st?.Self?.TailscaleIPs?.[0] ?? null;
    } catch {}
  }
  let serving = false;
  if (running && port) {
    const serve = await ts(bin, ["serve", "status", "--json"]);
    serving = !!serve && (serve.includes(`127.0.0.1:${port}`) || serve.includes(`localhost:${port}`));
  }
  return { installed: true, running, dnsName: running ? dnsName : null, ip: running ? ip : null, serving };
}

/** The machine's Tailscale MagicDNS name, if Tailscale is installed and up. */
export async function tailscaleHostname(): Promise<string | null> {
  const st = await tailscaleStatus();
  return st.dnsName ?? st.ip ?? tailscaleAddresses()[0] ?? null;
}

/**
 * The address a child's phone should use. Tailscale Serve (HTTPS, no port) if it's on, else Tailscale over plain
 * HTTP, else the first LAN IP.
 */
export async function childBaseUrl(port: number): Promise<{ base: string; via: "tailscale-https" | "tailscale" | "lan" | "localhost" }> {
  const st = await tailscaleStatus(port);
  if (st.serving && st.dnsName) return { base: `https://${st.dnsName}`, via: "tailscale-https" };
  if (st.running && (st.dnsName || st.ip)) return { base: `http://${st.dnsName ?? st.ip}:${port}`, via: "tailscale" };
  const lan = lanAddresses()[0];
  return lan ? { base: `http://${lan}:${port}`, via: "lan" } : { base: `http://localhost:${port}`, via: "localhost" };
}
