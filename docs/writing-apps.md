# Writing an OpenBuddies app

An OpenBuddies app is a folder of text: what the app is (`app.yaml`) and how the buddy should help in it (`SKILL.md`).
There's no code in an app, ever. That's what makes it safe for anyone to write one and for a parent to add it: an app
can't run anything on the family's computer, can't give the buddy new tools, and can't get round OpenBuddies' rules.
Whatever an app says, the buddy never gives the answer to homework, worrying messages still alert the parent, and the
child's help level and daily allowance still apply.

Homework and Picture Studio are apps like this (`apps/` in this repo), and so are the starter apps in the gallery
(`gallery/`). Copy one to start.

## The folder

```
times-tables/
├─ app.yaml     what it is and what it uses
├─ SKILL.md     the buddy's instructions for this app
└─ README.md    optional: notes for parents and other app writers
```

Nothing else is allowed. The folder name is the app's id: 2 to 40 lowercase letters, numbers and dashes.

## app.yaml

```yaml
name: Times Tables                       # up to 30 characters
description: Quick-fire times tables.    # one line under the name, up to 80
art: chart                               # a built-in drawing for the card: chat, quiz, books, question, notebook, easel, chart, folder, shield
icon: brain                              # a Lucide icon name, used when there's no art
version: 1.0.0
author: Your name
kind: tutor                              # tutor: a chat. studio: plan a picture together, then "Make it"
needs: [reminders]                       # what it uses, from the list below
```

`needs` can only name features OpenBuddies already has:

| Need | What it means |
|---|---|
| `hint_ladder` | Homework-style help: a question first, then a nudge, then a worked example, never the answer. Without it, the buddy explains instead. |
| `files` | The child's files with that buddy (homework photos, notes). |
| `web` | Looking things up on the internet, if the parent allows it for the child. |
| `reminders` | The child can ask for reminders and plans in the app. |
| `pictures` | Making pictures (studio apps). |

An app that asks for anything else is refused.

## SKILL.md

Instructions for the buddy, in plain Markdown, up to 20,000 characters. Write them for a patient tutor talking with a
child of 8 to 16: what the app is for, how to run it (one question at a time, short replies), and what never to do.
Look at `gallery/spelling-bee/SKILL.md` for the shape.

OpenBuddies puts its own rules above your instructions, so you don't need to repeat them; don't try to change them
either (parents will read your SKILL.md before adding the app, and the leak check runs regardless).

## Trying it

Put the folder in your household's `apps/` folder (e.g. `~/openbuddies/apps/times-tables/`). OpenBuddies loads it straight
away; turn it on for a child on the parent page under **Apps**, or with `openbuddies apps on <child> times-tables`.

## Sharing it

**As one file.** An app bundle is JSON:

```json
{ "id": "times-tables", "files": { "app.yaml": "name: Times Tables\n...", "SKILL.md": "# Times Tables\n..." } }
```

Put it anywhere with an https link. A parent adds it with `openbuddies apps add https://…/times-tables.json` or under
**Apps → Add an app by link**, after reading it in full.

**In a catalogue.** A catalogue is an `index.json` listing bundles, each with the SHA-256 of the bundle file, so a
changed download is refused:

```json
{
  "name": "Mrs Smith's class apps",
  "apps": [
    { "id": "times-tables", "name": "Times Tables", "description": "Quick-fire times tables.", "author": "Mrs Smith",
      "version": "1.0.0", "bundle": "times-tables.json", "sha256": "…" }
  ]
}
```

Parents add the catalogue's link under **Apps → Catalogues** (or `apps.catalogues` in `openbuddies.yaml`), and its apps
appear in their gallery. Bundle links are relative to the catalogue.

Whichever way it comes, an app is added only after the parent has seen everything it is, the copy installed is the one
they saw (by its fingerprint), and it starts switched off for every child until the parent picks who gets it.
