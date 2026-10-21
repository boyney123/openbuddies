// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";

export default defineConfig({
  // Placeholder until launch; keep in step with SITE.url in src/site.ts.
  site: "https://openbuddies.example",
  // Keeps the toolbar out of the way, including out of the image captures (pnpm images).
  devToolbar: { enabled: false },
  integrations: [
    // ```mermaid blocks, drawn in the browser. Before Starlight, so its code highlighting doesn't take them. One theme
    // for light and dark: the colours come from the docs' own variables (src/styles/mermaid.css).
    mermaid({
      theme: "base",
      autoTheme: false,
      enableLog: false,
      mermaidConfig: {
        fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
        themeVariables: { fontSize: "14px" },
        // Compact: small diagrams stay small, and labels wrap rather than stretching a diagram past the page.
        flowchart: { curve: "basis", padding: 8, nodeSpacing: 24, rankSpacing: 30, diagramPadding: 4, wrappingWidth: 160 },
      },
    }),
    // The docs, at /docs (src/content/docs/docs/), organised the Diátaxis way: https://diataxis.fr
    starlight({
      title: "OpenBuddies Docs",
      logo: { src: "./src/assets/logo.svg", alt: "OpenBuddies" },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/boyney123/openbuddies" }],
      // Rounded code blocks: the whole frame, title bar and all.
      expressiveCode: { styleOverrides: { borderRadius: "1rem" } },
      customCss: ["@fontsource-variable/inter", "./src/styles/buddy.css", "./src/styles/docs.css", "./src/styles/mermaid.css"],
      sidebar: [
        { label: "Start here", items: [{ label: "Welcome", slug: "docs" }] },
        { label: "Tutorials", items: [{ autogenerate: { directory: "docs/tutorials" } }] },
        {
          label: "How-to guides",
          items: [
            { label: "For parents", items: [{ autogenerate: { directory: "docs/how-to/parents" } }] },
            { label: "For kids", items: [{ autogenerate: { directory: "docs/how-to/kids" } }] },
          ],
        },
        { label: "Reference", items: [{ autogenerate: { directory: "docs/reference" } }] },
        { label: "Explanation", items: [{ autogenerate: { directory: "docs/explanation" } }] },
        { label: "Writing your own app", items: [{ autogenerate: { directory: "docs/writing-apps" } }] },
      ],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
