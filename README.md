# Sync

Conversational integration layer for Claro's digital channels. Built for the FIAP
Challenge 2026 by team **Sync Unit** (4SI).

A customer starts a support conversation on the website, moves to WhatsApp, and
ends up with a human agent, without repeating anything. Context follows them.

**Team:** Leticia Vitalino (552481) · Gustavo Ressurreição (550983) · Bruno de
Castro (551411) · Isaac Destro (97847)

---

## The problem

A Claro customer opens the site, explains that their internet keeps dropping,
gets no resolution, and moves to WhatsApp. There they start over: CPF again,
problem again, which plan again. The journey is fragmented across channels, so
digital support resolves little and pushes people to the call centre.

## The solution

Sync sits between the digital channels and the support services. Any channel's
message enters through one normalisation layer. Sync identifies the customer,
classifies the intent, stores the context, and decides whether to answer or hand
over to a person, with the whole history attached.

```
Site ─┐
App  ─┼─► Sync layer ─► Gateway ─► Identity ──► Context database
WhatsApp ┘                          │
                                    └─► Conversation ─► NLP engine
                                              │
                                              ├─► automatic reply
                                              └─► agent console
```

---

## Running it

Requires Node 24 and Docker.

```bash
npm install
npm run db:up        # MySQL 8 on port 3307
npm run db:migrate
npm run db:seed
```

Copy `.env.example` to `.env`. `GEMINI_API_KEY` is optional: without it the
system classifies by rules alone and nothing breaks.

Then, in three terminals:

```bash
npm run dev          # API            http://localhost:3333
npm run dev:site     # customer site  http://localhost:5173
npm run dev:admin    # team console   http://localhost:5174
```

**Seeded logins**

| Where | Email | Password |
|---|---|---|
| Customer site | `maria.silva@exemplo.com` | first access with CPF `123.456.789-00` |
| Team console | `bruno@claro.com.br` | `Atendente123` |

## Checks

```bash
npm test         # 251 tests
npm run typecheck
npm run lint
```

---

## How it is put together

npm workspaces. A single Node process, with each box of the architecture diagram
isolated behind its own TypeScript interface, so pulling one out into a separate
service later is mechanical.

```
apps/
  api/          Express 5, the whole back end
    src/channels/      sync layer, normalises every channel into one shape
    src/gateway/       routes, validation, composition root
    src/auth/          customer and agent login, Argon2id, JWT, refresh rotation
    src/identity/      resolves a customer by login, phone, CPF or protocol
    src/conversation/  orchestration, escalation policy, automatic replies
    src/nlp/           rules, Gemini, cache, PII redaction
    src/insights/      offer suggestion from customer profile
    src/auth/roles.ts  permission table for agent and manager
    src/context/       Prisma repositories
    src/admin/         queue, conversation handling, metrics
  web-site/     customer chat, React 19 + Vite
  web-admin/    team console, React 19 + Vite
packages/
  contracts/    enums, Result<T> and Zod schemas shared by API and front ends
  chat-ui/      chat components shared across channels
  db/           Prisma schema, migrations, seed
docs/superpowers/  design spec and implementation plan
```

**Stack:** TypeScript, Express 5, Prisma, MySQL 8, React 19, Vite, Zod, Vitest,
Biome.

## Decisions worth knowing

**Intent classification is hybrid.** Rules first, cache in the middle, Gemini
only for what is left. The order is economics: the free tier is tight, so any
message a strong keyword already resolves never reaches the network. The LLM
handles the awkward phrasing, which is where it actually beats the rules.

**No personal data reaches the LLM.** CPF, phone and email are replaced with
markers before the request leaves, and the real entities are extracted locally by
regex. The cache is keyed on the redacted text, which also means two people
asking the same thing with different CPFs share one classification.

**A phone number never grants identity.** The contact phone a visitor types is
unverified, so it only helps find a conversation again. An earlier version
promoted the conversation to whoever owned that number, which leaked a
customer's name, service and invoice date to anyone who knew their phone.
Identity comes from login or from a CPF given in the dialogue. Confirming the
number by SMS is the production requirement, and is not in this MVP.

**Accounts cannot be enumerated.** Unknown email, wrong password and an account
without first access all return the same error constant.

**Refresh tokens rotate with family tracking.** Presenting an already rotated
token revokes the whole family, including the victim's live token. There is no
way to tell which of the two parties is legitimate, so both go.

**Roles are a permission table, not scattered checks.** Two roles exist, agent
and manager, and what each can do is declared as data in one place. A scattered
`if (role === ...)` means every forgotten place is a hole. The role is read from
the database on every request rather than from the token: demoting somebody has
to take effect at once, and a fifteen minute JWT would carry the old role that
whole time.

**Agents see their own numbers, managers see the team.** An agent cannot read a
colleague's queue by changing a query parameter, and cannot read their numbers by
changing a path segment. Both are covered by tests. Handling time is measured
from the moment an agent claims a conversation, not from when it was created,
because the queue wait is not their responsibility.

**The console board is organised by intent, not by workflow stage.** Columns run
in order of the cost of ignoring them, so cancellation sits leftmost and reading
order becomes triage order.

**Offer suggestions are generated when an agent claims a conversation.** That is
when they are used. Rules always produce one, so the panel is never empty and
never depends on LLM quota, and their order is business priority: an open
technical fault beats any sale, and an overdue invoice beats retention. What
reaches the model is a profile of counts and intents, never the conversation.

**The customer sees what Sync knows.** The context rail on the chat is always
visible. It is the point of the product made legible, and it doubles as LGPD
transparency: people see exactly which of their data the conversation holds.

## Where it stands

Done: channel intake, identification, intent classification, context
persistence, escalation, customer site, agent console, metrics.

Next: the real WhatsApp handoff through the Meta Cloud API, and the app front
end. The handoff button is already designed into the context rail and turns on
when that lands.
