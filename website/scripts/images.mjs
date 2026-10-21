// Captures the site's images into public/ with headless Chrome: the share image (src/pages/og.astro), the README banner
// (src/pages/banner.astro) and the logo (src/pages/brand/[image].astro). Run with the dev server up: `pnpm dev`, then `pnpm images`.
// Set CHROME to use a different browser binary, or BASE_URL for a different server.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = process.env.BASE_URL ?? "http://localhost:4321";

const shots = [
  { path: "/og", out: "og.png", size: [1200, 630] },
  // Twice the size, so it stays sharp on GitHub.
  { path: "/banner", out: "banner.png", size: [1280, 400], scale: 2 },
  { path: "/brand/mark", out: "logo.png", size: [512, 512], transparent: true },
  { path: "/brand/wordmark", out: "logo-wordmark.png", size: [1400, 320], transparent: true },
  { path: "/brand/icon", out: "icon-512.png", size: [512, 512] },
];

for (const s of shots) {
  const out = fileURLToPath(new URL(`../public/${s.out}`, import.meta.url));
  execFileSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--window-size=${s.size.join(",")}`,
    `--force-device-scale-factor=${s.scale ?? 1}`,
    "--virtual-time-budget=3000",
    ...(s.transparent ? ["--default-background-color=00000000"] : []),
    `--screenshot=${out}`,
    base + s.path,
  ], { stdio: "ignore" });
  console.log(`Saved public/${s.out}`);
}
