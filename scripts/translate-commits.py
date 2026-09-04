#!/usr/bin/env python3
"""Rewrites every commit message in this repository from Portuguese to English.

Reads the original message on stdin and writes the translated one to stdout, which
is the contract `git filter-branch --msg-filter` expects. Messages already in
English, and any message not in the table, pass through untouched.
"""
import sys

TRADUCOES = {
    "docs: design do MVP do Sync": """docs: Sync MVP design

Derives the technical design from the Sprint 2 deliverables (Solution Vision
and Technical Documentation). Maps the seven components of the architecture
diagram onto modules, and defines the data model, intent taxonomy, hybrid NLP
pipeline, escalation policy, WhatsApp handoff via the Meta Cloud API, and the
implementation phases.""",

    "docs: login real de cliente no lugar do login mockado": """docs: real customer login instead of a mocked one

One auth module serves both customers and agents: Argon2id, 15 minute JWT,
refresh with rotation and family tracking. No open sign-up; the customer base
is seeded and people prove identity by matching CPF and email against an
existing record. Anonymous chat still works. Phases renumbered 0 to 8.""",

    "docs: plano 1 de implementacao, fundacao e nucleo do backend": """docs: implementation plan 1, foundation and backend core

Twelve TDD tasks covering phases 0 and 1 of the spec: workspace, MySQL in
Docker, context database schema, seed data for the three scenarios, shared
contracts, PII extraction, rule based classifier, escalation policy, automatic
replies, repositories, identity service, sync layer and HTTP gateway.""",

    "chore: workspace, ferramental e schema do banco de contexto": """chore: workspace, tooling and context database schema

Three deviations from the plan, all forced by the environment:
- .env is loaded by neither vitest nor tsx; client.ts walks up the tree and
  loads the root one, without overriding what the environment already set
- vitest 5 dropped poolOptions; serialisation is now fileParallelism
- prisma generate output is pinned to src/generated/prisma, so it no longer
  depends on where npm decides to hoist @prisma/client""",

    "feat: base semeada com o cliente dos tres cenarios": (
        "feat: seed data for the customer in all three scenarios"
    ),

    "feat: contratos compartilhados de enums, Result e mensagens": (
        "feat: shared contracts for enums, Result and messages"
    ),

    "feat: normalizacao de texto e extracao de entidades com redacao de PII": (
        "feat: text normalisation and entity extraction with PII redaction"
    ),

    "feat: classificador de intencao por regras com pesos": """feat: weighted rule based intent classifier

Ties break by intent priority. Without it "quero cancelar meu plano" would land
on CONSULTA_PLANO and the bot would answer a cancellation on its own.""",

    "feat: politica de escalonamento como funcao pura": (
        "feat: escalation policy as a pure function"
    ),

    "feat: geracao de resposta automatica e de escalonamento": (
        "feat: automatic reply and escalation message generation"
    ),

    "feat: repositorios do banco de contexto": "feat: context database repositories",

    "feat: servico de identificacao por id, telefone, cpf e protocolo": (
        "feat: identity service resolving by id, phone, CPF and protocol"
    ),

    "feat: camada sync de normalizacao de entrada dos canais web": (
        "feat: sync layer normalising inbound web channel payloads"
    ),

    "feat: orquestrador, gateway http e persistencia de contexto entre mensagens": """feat: orchestrator, HTTP gateway and context persistence across messages

RF005 was broken and no test in the plan caught it: the orchestrator only
looked at the identification carried by the current message, so a customer who
gave their CPF was asked for it again on the next one. The customerId already
stored on the conversation now applies whenever the message carries no
identification of its own.

Found by the manual verification in step 8 of task 12. A regression test was
added, named after the requirement.

Also: TypeScript 7 required Prisma.InputJsonValue for collectedData, and
Express 5 types req.params as string | string[].""",

    "merge: fundacao e nucleo do backend do Sync (fases 0 e 1)": (
        "merge: Sync backend foundation and core (phases 0 and 1)"
    ),

    "chore: scripts dev e start na raiz do workspace": (
        "chore: dev and start scripts at the workspace root"
    ),

    "chore: dependencias de autenticacao, argon2id e jose": """chore: authentication dependencies, argon2id and jose

@node-rs/argon2 ships prebuilt binaries, so it needs no build toolchain on
Windows. jose is pure JavaScript with no native dependency at all.""",

    "feat: modelo RefreshToken com rastreio de familia": """feat: RefreshToken model with family tracking

Each login opens a family. Each rotation issues a new token in the same family
and marks the previous one used. Presenting an already used token is a theft
signal and revokes the whole family.

Includes a Prisma CLI wrapper that loads the root .env: the CLI only looks in
the current directory, and duplicating DATABASE_URL under packages/db would
drift out of sync.""",

    "feat: hash e verificacao de senha com argon2id": (
        "feat: password hashing and verification with argon2id"
    ),

    "feat: servico de tokens, JWT de acesso e refresh opaco": """feat: token service, JWT access and opaque refresh

The refresh token is deliberately not a JWT: it has to be revocable server
side. It is stored only as a SHA-256 hash, so leaking the database does not
hand anyone a usable token.""",

    "feat: repositorio de refresh tokens com revogacao por familia": (
        "feat: refresh token repository with family wide revocation"
    ),

    "feat: busca por email e escrita de senha no repositorio de cliente": (
        "feat: email lookup and password writing in the customer repository"
    ),

    "feat: caso de uso de primeiro acesso": """feat: first access use case

Not sign-up: the customer base is seeded and people only prove identity by
matching CPF and email against an existing record. A missing CPF and a
mismatched email return the same error, otherwise it would be possible to
discover which CPFs are Claro customers.""",

    "feat: caso de uso de login": """feat: login use case

Unknown email, wrong password and an account without first access all return
the same error constant. Different messages would let someone enumerate which
emails have an account at Claro.""",

    "feat: rotacao de refresh com deteccao de reuso": """feat: refresh rotation with reuse detection

Presenting an already rotated token takes down the entire family, including
the victim's legitimate token. That is the correct behaviour: there is no way
to tell which of the two parties is the legitimate one.""",

    "feat: logout revogando a familia de refresh": (
        "feat: logout revoking the refresh family"
    ),

    "feat: middlewares optionalAuth e requireAuth": """feat: optionalAuth and requireAuth middlewares

optionalAuth treats an invalid token as absent: the site chat accepts anonymous
conversations, so rejecting would be worse than ignoring.""",

    "feat: rate limit em memoria por ip e rota": """feat: in-memory rate limit per IP and route

In-memory is enough for the MVP, which runs on a single instance. With more
than one instance this becomes Redis, otherwise each process counts separately
and the effective limit multiplies.""",

    "feat: rotas de autenticacao com validacao zod e rate limit": (
        "feat: authentication routes with zod validation and rate limiting"
    ),

    "feat: modulo auth na raiz de composicao": """feat: auth module in the composition root

JWT_SECRET has no default on purpose. A default secret in code is the security
flaw that most often survives all the way to production, because nothing breaks
without it.""",

    "feat: gateway le o customerId do token de acesso": """feat: gateway reads customerId from the access token

Never from the request body: accepting it there would let anyone hold a
conversation as if they were another customer. A test covers exactly that.""",
}


def main() -> None:
    original = sys.stdin.read()
    assunto = original.split("\n", 1)[0].strip()
    traduzido = TRADUCOES.get(assunto)
    sys.stdout.write(traduzido + "\n" if traduzido else original)


if __name__ == "__main__":
    main()
