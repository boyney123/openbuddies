// `openbuddies web`: set up and check looking things up on the internet (src/server/web.ts). The search key goes in the
// household .env next to the model key, readable only by you; the running server picks it up when .env changes.

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { DEFAULT_WEB, type Household, type SearchConfig } from "../server/config.js";
import { allowedUrl, providers, search, searchProviderName } from "../server/web.js";

const ENV_NAMES = { brave: "BRAVE_API_KEY", tavily: "TAVILY_API_KEY", searxng: "SEARXNG_BASE_URL" } as const;
type ProviderName = keyof typeof ENV_NAMES;

/** Set one variable in the household .env, keeping the rest. */
function setEnv(dir: string, name: string, value: string) {
  const path = join(dir, ".env");
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith(`${name}=`)) : [];
  writeFileSync(path, [...lines, `${name}=${value}`].join("\n") + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

const mask = (v: string) => (v.startsWith("http") ? v : `${v.slice(0, 4)}…${v.slice(-2)}`);

export function webStatus(h: Household) {
  const name = searchProviderName(h.search);
  console.log(name ? `Web search: ${name}${h.search.provider ? " (chosen)" : ""}` : "Web search: not set up. Run `openbuddies web setup`.");
  for (const k of Object.keys(ENV_NAMES) as ProviderName[]) if (h.search[k]) console.log(`  ${k.padEnd(8)} ${mask(h.search[k]!)}`);
  for (const c of h.children.values()) {
    const w = c.rules.web;
    const what = { off: "off", trusted: `trusted sites only${w.sites.length ? ` (+ ${w.sites.join(", ")})` : ""}`, open: "wider web" }[w.mode];
    console.log(`  ${c.profile.name}: ${what}, up to ${w.daily_lookups} lookups a day`);
  }
}

/** Search once and print what a child on the wider web could use. */
export async function webTest(search_: SearchConfig, query: string): Promise<boolean> {
  try {
    const { provider, results } = await search(search_, query);
    const usable = results.filter((r) => allowedUrl(r.url, DEFAULT_WEB));
    console.log(`${provider}: ${results.length} results, ${usable.length} usable`);
    for (const r of usable.slice(0, 5)) console.log(`  ${r.title}\n    ${r.url}`);
    return true;
  } catch (e) {
    console.error(`Search failed: ${(e as Error).message}`);
    return false;
  }
}

export async function webSetup(h: Household, opts: { provider?: string; key?: string }) {
  let provider = opts.provider as ProviderName | undefined;
  let value = opts.key;
  if (!provider || !value) {
    if (!process.stdin.isTTY) {
      console.error("Pass --provider brave|tavily|searxng and --key <key or SearXNG address>.");
      process.exit(1);
    }
    p.intro("Web search for OpenBuddies");
    p.note(
      "Buddies can look things up for your children: OpenBuddies searches, keeps only sites you allow, and passes on a few\nchild-friendly facts with their sources. Searches go to the provider you pick here.\n\nBrave: own index, strict SafeSearch. $5 free credit a month covers about 1,000 searches (api-dashboard.search.brave.com).\nTavily: another API with a free tier (tavily.com).\nSearXNG: a search engine you run yourself, so searches don't go to a company; no key.",
    );
    const picked = await p.select({
      message: "Which search provider?",
      options: [
        { value: "brave", label: "Brave", hint: "recommended" },
        { value: "tavily", label: "Tavily" },
        { value: "searxng", label: "SearXNG (self-hosted)" },
      ],
    });
    if (p.isCancel(picked)) process.exit(0);
    provider = picked as ProviderName;
    const entered =
      provider === "searxng"
        ? await p.text({ message: "SearXNG address", placeholder: "http://192.168.0.10:8888", validate: (v) => (/^https?:\/\/\S+$/.test(v ?? "") ? undefined : "Enter an http(s) address") })
        : await p.password({ message: `${provider === "brave" ? "Brave Search" : "Tavily"} API key`, validate: (v) => (v?.trim() ? undefined : "Enter the key") });
    if (p.isCancel(entered)) process.exit(0);
    value = String(entered).trim();
  }
  if (!(provider in ENV_NAMES)) {
    console.error("The provider must be brave, tavily or searxng.");
    process.exit(1);
  }
  const config: SearchConfig = { [provider]: value, provider };
  if (!providers(config).length) process.exit(1);
  console.log("Trying a search…");
  if (!(await webTest(config, "how many planets are in the solar system"))) {
    console.error("Nothing saved. Check the key (or address) and try again.");
    process.exit(1);
  }
  setEnv(h.dir, ENV_NAMES[provider], value);
  console.log(`Saved to ${join(h.dir, ".env")}. Each child's internet setting is on the parent page under Children, or: openbuddies children web <child> off|trusted|open`);
}
