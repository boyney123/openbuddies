<p align="center">
  <img src="website/public/banner.png" alt="OpenBuddies: AI study buddies for kids. You're in control." width="100%">
</p>

<p align="center">
  <b>Open-source AI study buddies for families, self-hosted at home.</b><br>
  A pair tutor, not an answer machine.
</p>

## Features

- **Kids make their own buddies** to chat, draw pictures, take quizzes and get homework help, from their phone or laptop.
- **A tutor, not an answer machine.** Buddies guide with questions and hints, so children work things out themselves.
- **Parents stay in control.** Read every message, and set each child's help level, daily AI allowance and apps.
- **It all stays at home.** It runs on a computer in your house, the chats are kept there, and your API key never leaves
  it.

## How it works

```mermaid
flowchart LR
  Child["Your child's phone or laptop"] -->|message| Home["OpenBuddies<br/>on your computer at home"]
  Home -->|checked reply| Child
  Home <-->|model calls only| AI["Your AI provider<br/>(Anthropic, OpenAI…)"]
  Parent["You, on your parent page"] -->|rules and help levels| Home
  Home -->|every chat and alerts| Parent
```

You install OpenBuddies at home and connect your own AI provider. Your child pairs their device with a QR code. Every
message is checked before a reply reaches them, and you see it all on your parent page.

## Screenshots

<table>
  <tr>
    <td align="center" valign="top"><img src="website/src/assets/screenshots/kid-make-buddy.png" width="190" alt="Making a buddy called Pip, who is best at maths"><br><sub>Kids make their own buddy</sub></td>
    <td align="center" valign="top"><img src="website/src/assets/screenshots/kid-chat-hint.png" width="190" alt="Pip giving a hint about fractions instead of the answer"><br><sub>Hints, not answers</sub></td>
    <td align="center" valign="top"><img src="website/src/assets/screenshots/kid-picture-studio.png" width="190" alt="Pip painting a picture of a dragon at the seaside"><br><sub>Picture Studio</sub></td>
    <td align="center" valign="top"><img src="website/src/assets/screenshots/kid-quiz-take.png" width="190" alt="A multiple choice quiz question"><br><sub>Quizzes on anything</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td align="center" valign="top"><img src="website/src/assets/screenshots/parent-overview.png" width="400" alt="The parent page overview, with a card for each child and their latest sessions"><br><sub>Every child at a glance</sub></td>
    <td align="center" valign="top"><img src="website/src/assets/screenshots/parent-conversation.png" width="400" alt="A chat, with what the child saw and what happened behind the scenes"><br><sub>Read every message, and why the buddy said it</sub></td>
  </tr>
</table>

## Get started

You'll need a computer that stays at home (macOS or Linux), Node.js 22 or newer, and an API key from your AI provider.

```
npm install -g openbuddies
openbuddies init      # set up your household (about 2 minutes)
openbuddies start     # your parent page opens; scan the QR code with your child's phone
```

## Learn more

- **[Docs](website/src/content/docs/docs/)**: the [setup tutorial](website/src/content/docs/docs/tutorials/set-up-your-household.mdx),
  guides for parents and kids, and how it all works. Run `cd website && pnpm install && pnpm dev` to read them locally.
- **[Technical reference](docs/technical-reference.md)**: commands, the security model and development.

## Licence

MIT. See [LICENSE](LICENSE).
