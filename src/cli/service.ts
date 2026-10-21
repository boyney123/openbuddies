// Background service: launchd on macOS, a systemd user unit on Linux, or a detached process as a fallback.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageRoot } from "../server/paths.js";

const LABEL = "dev.openbuddies";
const plistPath = () => join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const unitPath = () => join(homedir(), ".config", "systemd", "user", "openbuddies.service");
const pidPath = (home: string) => join(home, "data", "openbuddies.pid");
export const serverLogPath = (home: string) => join(home, "logs", "server.log");

/** The command that runs the server in the foreground, as an argv array. Works from dist/ or from src/ via tsx. */
export function serveCommand(home: string): string[] {
  const entry = fileURLToPath(import.meta.url).replace(/service\.(ts|js)$/, "index.$1");
  const node = entry.endsWith(".ts") ? [process.execPath, "--import", "tsx", entry] : [process.execPath, entry];
  return [...node, "serve", "--home", home];
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type ServiceKind = "launchd" | "systemd" | "none";

export function serviceKind(): ServiceKind {
  if (process.platform === "darwin") return "launchd";
  if (process.platform === "linux") {
    try {
      execFileSync("systemctl", ["--user", "--version"], { stdio: "ignore" });
      return "systemd";
    } catch {}
  }
  return "none";
}

/** The household folder the installed service runs, read from its --home argument. */
export function serviceHome(): string | null {
  const kind = serviceKind();
  const file = kind === "launchd" ? plistPath() : kind === "systemd" ? unitPath() : null;
  if (!file || !existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const m = kind === "launchd" ? text.match(/<string>--home<\/string>\s*<string>([^<]+)<\/string>/) : text.match(/--home\s+("([^"]+)"|(\S+))/);
  if (!m) return null;
  const raw = kind === "launchd" ? m[1] : (m[2] ?? m[3]);
  return resolve(raw.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
}

/**
 * Whether an OpenBuddies service is installed. With `home`, only if it runs that household: a command for one household
 * must never stop or remove another household's service.
 */
export function serviceInstalled(home?: string): boolean {
  const kind = serviceKind();
  const installed = (kind === "launchd" && existsSync(plistPath())) || (kind === "systemd" && existsSync(unitPath()));
  return installed && (!home || serviceHome() === resolve(home));
}

export function installService(home: string): { kind: ServiceKind; note?: string } {
  const kind = serviceKind();
  const cmd = serveCommand(home);
  mkdirSync(join(home, "logs"), { recursive: true });
  const log = serverLogPath(home);
  if (kind === "launchd") {
    mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${cmd.map((a) => `    <string>${xmlEscape(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${xmlEscape(packageRoot())}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xmlEscape(log)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(log)}</string>
</dict>
</plist>
`;
    try {
      execFileSync("launchctl", ["bootout", `gui/${process.getuid!()}/${LABEL}`], { stdio: "ignore" });
    } catch {}
    writeFileSync(plistPath(), plist);
    execFileSync("launchctl", ["bootstrap", `gui/${process.getuid!()}`, plistPath()], { stdio: "ignore" });
    return { kind };
  }
  if (kind === "systemd") {
    mkdirSync(join(homedir(), ".config", "systemd", "user"), { recursive: true });
    const q = (a: string) => (/[\s"\\]/.test(a) ? `"${a.replace(/(["\\])/g, "\\$1")}"` : a);
    writeFileSync(
      unitPath(),
      `[Unit]
Description=OpenBuddies homework tutor
After=network-online.target

[Service]
ExecStart=${cmd.map(q).join(" ")}
WorkingDirectory=${packageRoot()}
Restart=on-failure
RestartSec=3
StandardOutput=append:${log}
StandardError=append:${log}

[Install]
WantedBy=default.target
`,
    );
    execFileSync("systemctl", ["--user", "daemon-reload"]);
    execFileSync("systemctl", ["--user", "enable", "--now", "openbuddies.service"], { stdio: "ignore" });
    return { kind, note: `To keep OpenBuddies running when you're logged out, run: sudo loginctl enable-linger ${process.env.USER ?? "$USER"}` };
  }
  return { kind, note: "No service manager found. `openbuddies start` will run OpenBuddies in the background instead." };
}

export function uninstallService() {
  const kind = serviceKind();
  if (kind === "launchd" && existsSync(plistPath())) {
    try {
      execFileSync("launchctl", ["bootout", `gui/${process.getuid!()}/${LABEL}`], { stdio: "ignore" });
    } catch {}
    rmSync(plistPath());
  }
  if (kind === "systemd" && existsSync(unitPath())) {
    try {
      execFileSync("systemctl", ["--user", "disable", "--now", "openbuddies.service"], { stdio: "ignore" });
    } catch {}
    rmSync(unitPath());
  }
}

export function startBackground(home: string): "service" | "process" {
  if (serviceInstalled(home)) {
    if (serviceKind() === "launchd") {
      try {
        execFileSync("launchctl", ["bootstrap", `gui/${process.getuid!()}`, plistPath()], { stdio: "ignore" });
      } catch {
        // Already loaded: make sure it is running.
        execFileSync("launchctl", ["kickstart", `gui/${process.getuid!()}/${LABEL}`], { stdio: "ignore" });
      }
    } else {
      execFileSync("systemctl", ["--user", "start", "openbuddies.service"], { stdio: "ignore" });
    }
    return "service";
  }
  const [bin, ...args] = serveCommand(home);
  mkdirSync(join(home, "logs"), { recursive: true });
  const out = openSync(serverLogPath(home), "a");
  const child = spawn(bin, args, { detached: true, stdio: ["ignore", out, out], cwd: packageRoot() });
  child.unref();
  mkdirSync(join(home, "data"), { recursive: true });
  writeFileSync(pidPath(home), String(child.pid));
  return "process";
}

export function stopBackground(home: string): boolean {
  if (serviceInstalled(home)) {
    try {
      // bootout, not kill: KeepAlive would restart a killed process. RunAtLoad brings it back at next login.
      if (serviceKind() === "launchd") execFileSync("launchctl", ["bootout", `gui/${process.getuid!()}/${LABEL}`], { stdio: "ignore" });
      else execFileSync("systemctl", ["--user", "stop", "openbuddies.service"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  if (!existsSync(pidPath(home))) return false;
  const pid = Number(readFileSync(pidPath(home), "utf8"));
  rmSync(pidPath(home));
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

/** What a running server says about itself on this computer (see /api/health). */
export interface RunningServer {
  home?: string;
  householdId?: string;
  code?: string;
  pid?: number;
}

/** The server answering on this port on this computer, or null if nothing does. */
export async function runningServer(port: number): Promise<RunningServer | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? ((await res.json()) as RunningServer) : null;
  } catch {
    return null;
  }
}

/**
 * Why the running server shouldn't be reused for this household, or null if it's fine: it runs a different folder,
 * an earlier setup of this one (from before `openbuddies init`), or older code than is installed now.
 */
export function staleReason(running: RunningServer, home: string, current: { householdId: string; code: string }): string | null {
  if (!running.home) return "it's an older version of OpenBuddies";
  if (resolve(running.home) !== resolve(home)) return `it's running a different household (${running.home})`;
  if (running.householdId !== current.householdId) return "it's running this folder's previous setup";
  if (running.code !== current.code) return "it's running an older version of OpenBuddies";
  return null;
}

/** Stop this household's server however it was started, and wait until the port is free. */
export async function stopServer(home: string, port: number): Promise<boolean> {
  stopBackground(home);
  const running = await runningServer(port);
  // Started some other way (e.g. `openbuddies serve` in a terminal): stop it by its pid, if it's this household's.
  if (running?.pid && running.home && resolve(running.home) === resolve(home)) {
    try {
      process.kill(running.pid, "SIGTERM");
    } catch {}
  }
  for (let i = 0; i < 40; i++) {
    if (!(await runningServer(port))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
