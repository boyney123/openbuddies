# Agents guide

## Project status: live

OpenBuddies is published and families are using it. Their household folders (settings, rules, `.env`, the database,
buddies' files and memory) must keep working when they upgrade, and they upgrade by installing the latest version and
running `openbuddies start`. So:

- **Never edit or delete an existing migration.** Every database change is a new numbered file in `migrations/`. A
  migration that has run is never run again, so an edited one silently leaves upgraded households on the old schema.
- **Keep reading old settings.** A change to `openbuddies.yaml`, `rules.yaml`, `profile.yaml`, app files or `.env`
  names keeps loading the old form and upgrades it when it loads (or when saved), so the server still starts.
- **Don't break commands or their options** without good reason. When one has to change, keep the old form working
  with a short message pointing to the new one.
- **Keep the child app and the server in step.** A device can load the new web app while the old server is still
  running, or the other way round, until the parent restarts.
- **Delete what isn't used.** Remove dead code rather than leaving it commented out or behind a flag. Code that reads
  an old format is still used.

When a breaking change is truly needed, say so in the change, give it an upgrade path, and note it for the release.

## Keep the docs up to date

Every code change includes a docs review. Before you finish, check what the change touches and update it in the same
piece of work:

- `docs/technical-reference.md`: commands, the household folder layout, the pipeline, the security model and the
  decisions list. `README.md` stays high level: what OpenBuddies is, what it aims to do and how it works.
- The website docs in `website/src/content/docs/`: tutorials, how-to guides, the settings, commands and environment
  references, and the explanations.
- The website's landing page copy in `website/src/components/` (the FAQ, "How it works", the parent and safety
  sections), so it never promises something the code no longer does.

Search the docs for the names you changed (settings, commands, env vars, features) and remove anything that's gone.

The safety rules still apply in full: the child never gets answers, rules or prompts; the API key never leaves the box.
See docs/technical-reference.md for the security model.
