// Notifications on the child's phone or laptop (Web Push), for reminders going off. The browser gives us an address
// at its maker's push service (Google, Apple, Mozilla, Microsoft); we send the notification there, encrypted end to
// end, so the push service sees that a notification was sent but not what it says. The keys that sign our requests
// (VAPID) are made once and kept in data/vapid.json.
//
// The address comes from the child's device, so it's only accepted at a known push service: otherwise a device could
// make the server send requests anywhere, including to machines on the home network.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import webpush from "web-push";
import type { Db } from "./db.js";

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

/** A push subscription from a browser, if it's well-formed and at a known push service. */
export function checkSubscription(raw: any): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  if (!raw || typeof raw.endpoint !== "string" || raw.endpoint.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(raw.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port || !PUSH_HOSTS.some((h) => h.test(url.hostname))) return null;
  const { p256dh, auth } = raw.keys ?? {};
  const b64url = /^[A-Za-z0-9_-]+={0,2}$/;
  if (typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 200 || auth.length > 100 || !b64url.test(p256dh) || !b64url.test(auth)) return null;
  return { endpoint: raw.endpoint, keys: { p256dh, auth } };
}

export class PushSender {
  constructor(
    private db: Db,
    private home: () => string,
    private log?: (msg: string) => void,
  ) {}

  private vapid(): { publicKey: string; privateKey: string } {
    const path = join(this.home(), "data", "vapid.json");
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
    const keys = webpush.generateVAPIDKeys();
    mkdirSync(join(this.home(), "data"), { recursive: true });
    writeFileSync(path, JSON.stringify(keys), { mode: 0o600 });
    return keys;
  }

  /** The key a browser needs to subscribe. */
  publicKey(): string {
    return this.vapid().publicKey;
  }

  /** Send to every subscribed device of the child. Never throws; gone subscriptions are removed. */
  async notify(childId: string, n: { title: string; body: string; url: string }): Promise<void> {
    const subs = this.db.pushSubscriptions(childId);
    if (!subs.length) return;
    const { publicKey, privateKey } = this.vapid();
    const payload = JSON.stringify({ title: n.title.slice(0, 80), body: n.body.slice(0, 200), url: n.url });
    await Promise.all(
      subs.map(async (sub) => {
        try {
          // The subject is a contact address push services require; this one is a placeholder that says nothing about the family.
          await webpush.sendNotification(sub, payload, { vapidDetails: { subject: "mailto:openbuddies@example.com", publicKey, privateKey }, TTL: 3600, timeout: 8000 });
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.statusCode === 410) this.db.removePushSubscription(sub.endpoint);
          else this.log?.(`notification not delivered: ${e?.statusCode ?? ""} ${String(e?.message ?? e).slice(0, 120)}`);
        }
      }),
    );
  }
}
