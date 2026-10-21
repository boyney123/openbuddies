// Parent PIN auth and the network rules for who may reach what.

import argon2 from "argon2";
import { randomBytes } from "node:crypto";

export const hashPin = (pin: string) => argon2.hash(pin, { type: argon2.argon2id });

export function validPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

/** Strip the IPv4-mapped IPv6 prefix Node reports for IPv4 clients. */
export function normaliseIp(ip: string | undefined): string {
  if (!ip) return "";
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

export function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip.startsWith("127.");
}

/** Tailscale uses 100.64.0.0/10 for IPv4 and fd7a:115c:a1e0::/48 for IPv6. */
export function isTailscale(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) return +v4[1] === 100 && +v4[2] >= 64 && +v4[2] <= 127;
  return ip.toLowerCase().startsWith("fd7a:115c:a1e0:");
}

export function isPrivateLan(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) {
    const [a, b] = [+v4[1], +v4[2]];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  const l = ip.toLowerCase();
  return l.startsWith("fe80:") || l.startsWith("fc") || l.startsWith("fd");
}

/** Child devices: loopback, LAN or Tailscale. Never a public address. */
export function allowedClient(ip: string): boolean {
  return isLoopback(ip) || isTailscale(ip) || isPrivateLan(ip);
}

/** The parent page: loopback or Tailscale only. */
export function allowedParent(ip: string): boolean {
  return isLoopback(ip) || isTailscale(ip);
}

/** In-memory parent sessions and a failed-PIN limiter. Restarting the server logs the parent out. */
export class ParentAuth {
  private sessions = new Map<string, number>();
  private failures = new Map<string, number[]>();
  static readonly SESSION_MS = 12 * 60 * 60_000;
  static readonly WINDOW_MS = 15 * 60_000;
  static readonly MAX_FAILURES = 5;

  constructor(private pinHash: () => string) {}

  /** Seconds until this IP may try again, or 0. */
  lockedFor(ip: string): number {
    const recent = (this.failures.get(ip) ?? []).filter((t) => Date.now() - t < ParentAuth.WINDOW_MS);
    this.failures.set(ip, recent);
    if (recent.length < ParentAuth.MAX_FAILURES) return 0;
    return Math.ceil((recent[0] + ParentAuth.WINDOW_MS - Date.now()) / 1000);
  }

  async login(ip: string, pin: string): Promise<{ ok: true; token: string } | { ok: false; status: 401 | 429; retryAfter?: number }> {
    const locked = this.lockedFor(ip);
    if (locked) return { ok: false, status: 429, retryAfter: locked };
    const good = validPin(pin) && (await argon2.verify(this.pinHash(), pin).catch(() => false));
    if (!good) {
      this.failures.set(ip, [...(this.failures.get(ip) ?? []), Date.now()]);
      return { ok: false, status: 401 };
    }
    this.failures.delete(ip);
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, Date.now() + ParentAuth.SESSION_MS);
    return { ok: true, token };
  }

  check(token: string | undefined): boolean {
    if (!token) return false;
    const exp = this.sessions.get(token);
    if (!exp) return false;
    if (exp < Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  logout(token: string | undefined) {
    if (token) this.sessions.delete(token);
  }
}
