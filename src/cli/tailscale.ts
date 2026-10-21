// Interactive Tailscale setup: install (with consent), sign in, then Tailscale Serve for an HTTPS address that only
// the family's own devices can reach. Used by `openbuddies init` and `openbuddies tailscale`.

import * as p from "@clack/prompts";
import { spawnSync } from "node:child_process";
import open from "open";
import qrcode from "qrcode-terminal";
import { tailscaleBin, tailscaleStatus, type TailscaleStatus } from "../server/network.js";

const INSTALL_SCRIPT = "curl -fsSL https://tailscale.com/install.sh | sh";
const DOWNLOAD = "https://tailscale.com/download";

function stop<T>(v: T): Exclude<T, symbol> | null {
  return p.isCancel(v) ? null : (v as Exclude<T, symbol>);
}

const sudo = (args: string[]) => (process.getuid?.() === 0 ? args : ["sudo", ...args]);
const runInherit = (cmd: string[]) => spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit" }).status === 0;

async function install(): Promise<boolean> {
  if (process.platform === "linux") {
    const ok = stop(
      await p.confirm({
        message: `Install Tailscale with its official installer? This runs:\n  ${INSTALL_SCRIPT}\nand will ask for your password (sudo).`,
        initialValue: true,
      }),
    );
    if (!ok) return false;
    return runInherit(["sh", "-c", INSTALL_SCRIPT]);
  }
  if (process.platform === "darwin") {
    p.note(`Opening ${DOWNLOAD}/mac\nInstall Tailscale, open it from Applications, and sign in.\nThe Mac App Store version works too.`, "Install Tailscale");
    await open(`${DOWNLOAD}/mac`).catch(() => {});
    for (;;) {
      const next = stop(
        await p.select({
          message: "Once Tailscale is installed and signed in:",
          options: [
            { value: "check", label: "Done, carry on" },
            { value: "skip", label: "Skip Tailscale for now" },
          ],
        }),
      );
      if (next !== "check") return false;
      if ((await tailscaleStatus(undefined, { fresh: true })).installed) return true;
      p.log.warn("I can't find Tailscale yet. Make sure it's open (look for its icon in the menu bar).");
    }
  }
  p.log.info(`Install Tailscale from ${DOWNLOAD}, then run \`openbuddies tailscale\`.`);
  return false;
}

async function signIn(): Promise<boolean> {
  const bin = tailscaleBin()!;
  p.log.step("Sign in to Tailscale. Scan the QR code below with your phone, or open the link it prints.");
  // --operator lets this user run `tailscale serve` later without sudo (Linux only).
  const args = process.platform === "linux" ? sudo([bin, "up", "--qr", `--operator=${process.env.USER ?? ""}`]) : [bin, "up", "--qr"];
  runInherit(args);
  return (await tailscaleStatus(undefined, { fresh: true })).running;
}

async function serve(port: number): Promise<boolean> {
  const bin = tailscaleBin()!;
  p.log.step("Turning on Tailscale Serve (HTTPS for your devices only, never the public internet).");
  p.log.info("If it asks you to enable HTTPS or Serve for your tailnet, open the link it prints, click enable, and it will carry on.");
  if (runInherit([bin, "serve", "--bg", String(port)])) return true;
  // Without --operator (or on some installs) serve needs root.
  return process.platform === "linux" && runInherit(sudo([bin, "serve", "--bg", String(port)]));
}

export function printPhoneSteps(childNames: string[]) {
  const who = childNames.length ? childNames.join(" and ") + "'s" : "your child's";
  p.note(
    `On ${who} phone (and yours, for the parent page):\n1. Install the Tailscale app (scan below)\n2. Sign in with the same account you just used\n3. Then scan the OpenBuddies pairing code from \`openbuddies start\``,
    "Phones",
  );
  qrcode.generate(DOWNLOAD, { small: true }, (q) => console.log(q.replace(/^/gm, "  ")));
}

/**
 * Walk the parent through Tailscale. Asks before installing anything. Returns the final status; never throws for a
 * declined or failed step, because OpenBuddies works on home Wi-Fi without it.
 */
export async function setupTailscale(port: number, opts: { childNames?: string[]; fromInit?: boolean } = {}): Promise<TailscaleStatus> {
  let st = await tailscaleStatus(port, { fresh: true });
  if (st.serving) {
    p.log.success(`Tailscale is on: https://${st.dnsName}`);
    return st;
  }

  if (!st.installed) {
    p.note(
      [
        "Tailscale is a free private network for your family's devices. With it:",
        "• the phone works away from home Wi-Fi (school, grandparents)",
        "• you can open the parent page from your own phone",
        "• OpenBuddies gets an HTTPS address, so it installs like a real app",
        "Nothing is opened to the public internet.",
      ].join("\n"),
      "Recommended: Tailscale",
    );
    const choice = stop(
      await p.select({
        message: "Set up Tailscale?",
        initialValue: "yes",
        options: [
          { value: "yes", label: "Yes, set it up now", hint: "recommended" },
          { value: "no", label: opts.fromInit ? "Not now, home Wi-Fi only" : "Cancel", hint: "run `openbuddies tailscale` any time" },
        ],
      }),
    );
    if (choice !== "yes" || !(await install())) return tailscaleStatus(port);
    st = await tailscaleStatus(port, { fresh: true });
  } else if (!st.running || opts.fromInit) {
    const use = stop(
      await p.confirm({
        message: st.running ? `Tailscale is connected as ${st.dnsName}. Use it for OpenBuddies?` : "Tailscale is installed but not signed in. Sign in now?",
        initialValue: true,
      }),
    );
    if (!use) return st;
  }

  if (!st.running && !(await signIn())) {
    p.log.warn("Tailscale isn't signed in yet. Run `openbuddies tailscale` to try again.");
    return tailscaleStatus(port);
  }
  if (!(await serve(port))) {
    p.log.warn("Couldn't turn on Tailscale Serve. OpenBuddies still works over Tailscale on http, port " + port + ".");
    return tailscaleStatus(port);
  }
  st = await tailscaleStatus(port, { fresh: true });
  if (st.serving) p.log.success(`OpenBuddies will be at https://${st.dnsName}`);
  printPhoneSteps(opts.childNames ?? []);
  return st;
}

export async function tailscaleOff(port: number): Promise<boolean> {
  const bin = tailscaleBin();
  if (!bin) return false;
  // Only remove our HTTPS handler, not any other Serve config the parent has.
  return runInherit([bin, "serve", "--https=443", "off"]) || (process.platform === "linux" && runInherit(sudo([bin, "serve", "--https=443", "off"])));
}

