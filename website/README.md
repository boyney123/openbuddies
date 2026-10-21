# OpenBuddies website

The website and docs for OpenBuddies, built with Astro, Tailwind and Starlight. It lives in `website/` next to the app,
and is its own project (its own `package.json`, lockfile and `pnpm-workspace.yaml`), so run its commands from here.

It uses the app's brand: Inter, the navy / Tutor Blue / coral palette, the buddy face and accessories, and the
illustrations from `../web/src/components/brand.tsx`.

```
pnpm install
pnpm dev        # http://localhost:4321
pnpm build      # static site in dist/
pnpm images     # with the dev server up: recapture the share image and logo PNGs in public/
```

- `src/site.ts`: the product name, wordmark, tagline, GitHub link and site address. Change the name
  here. Set `url` to the real address before launch, as share images need a full link.
- `src/pages/index.astro`: the page, in the order a new parent wants to know things: what it is, why it matters, how
  it works, what kids get, what parents control, why it's safe, how to start, questions.
- `src/components/Icon.astro` and `Glyph.astro`: the site's own icons, drawn in the app's illustration style (no icon
  library). Icons are the illustrated ones; glyphs are small marks for buttons and labels.
- `src/components/Buddy.astro`: the buddy, drawn like the app's `BuddyFace`. Mood is a `data-mood` attribute, colour is
  CSS variables, so scripts can change both live.
- Docs: Starlight, at `/docs`, written in `src/content/docs/docs/` and organised the [Diátaxis](https://diataxis.fr)
  way: `tutorials/` (learning by doing), `how-to/` (getting a job done), `reference/` (looking things up) and
  `explanation/` (understanding why). The sidebar lists each folder automatically; `sidebar.order` in a page's
  frontmatter sets its place. The docs theme is `src/styles/docs.css`, and its logo `src/assets/logo.svg`.
- Logo: the three-buddy mark is `logo` in `src/components/Art.astro`. `pnpm images` exports `public/logo.png`
  (transparent, 512px), `public/logo-wordmark.png` (transparent, with the name), `public/icon-512.png` (on white)
  and `public/og.png` from the pages in `src/pages/brand/` and `src/pages/og.astro`. `public/favicon.svg` is drawn
  by hand from the same shapes, so update it if the mark changes; `apple-touch-icon.png` is `icon-512.png` at 180px.
- `src/components/Art.astro`: the app's illustrations (books, chat, quiz, easel, folder, notebook, shield, logo).
- `src/scripts/site.ts`: everything that moves: eyes following the pointer, tapping buddies, buddies wandering the hills,
  the buddy maker, the chat demo, copying the install commands and hatching the egg. Honours reduced motion.
