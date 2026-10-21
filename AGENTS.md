# Agents guide

## Project status: work in progress

OpenBuddies hasn't gone live. Nothing here is set in stone, and no one depends on the current code, data or formats yet.

When refactoring or changing things:

- **No backwards compatibility needed.** Change or replace code, APIs, file formats and CLI commands freely. Don't
  keep old code paths, shims, deprecated aliases or "legacy" fallbacks.
- **No data migrations needed.** It's fine to edit the existing SQL migrations in place, or to start them over, instead
  of adding new migration files. Households created before a change can be thrown away
  (`openbuddies reset`, then `openbuddies init`).
- **Delete what isn't used.** Remove dead code rather than leaving it commented out or behind a flag.

This changes once OpenBuddies has real users. That will be stated here.

## Keep the docs up to date

Every code change includes a docs review. Before you finish, check what the change touches and update it in the same
piece of work:

- `README.md`: commands, the household folder layout, the pipeline, the security model and the decisions list.
- The website docs in `website/src/content/docs/`: tutorials, how-to guides, the settings, commands and environment
  references, and the explanations.
- The website's landing page copy in `website/src/components/` (the FAQ, "How it works", the parent and safety
  sections), so it never promises something the code no longer does.

Search the docs for the names you changed (settings, commands, env vars, features) and remove anything that's gone.

The safety rules still apply in full: the child never gets answers, rules or prompts; the API key never leaves the box.
See README.md for the security model.
