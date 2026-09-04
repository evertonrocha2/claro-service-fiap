# Sync - Plano 1: Fundação e Núcleo do Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o núcleo do Sync funcionando ponta a ponta pelo backend: uma mensagem de qualquer canal entra, o cliente é identificado, a intenção é classificada por regras, o contexto é persistido em MySQL e uma resposta automática volta.

**Architecture:** Monolito modular em Node. Cada componente do diagrama de arquitetura da Documentação Técnica vira um módulo isolado atrás de uma interface TypeScript dentro de `apps/api/src/`. A lógica de decisão (classificação e escalonamento) é composta por funções puras, testáveis sem banco e sem rede. Só os repositórios tocam o Prisma.

**Tech Stack:** Node 24, TypeScript strict, Express 5, Prisma + MySQL 8 (Docker), Zod, Vitest, Supertest, Biome, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-03-sync-mvp-design.md`

## Global Constraints

- Node 24, npm workspaces. Sem pnpm, sem yarn, sem turborepo.
- TypeScript com `strict: true`. Nenhum `any` implícito ou explícito no código de produção.
- Toda operação que pode falhar devolve `Result<T>`, nunca lança exceção para o chamador.
- Nenhum teste faz chamada de rede externa. Gemini e Meta não existem neste plano.
- Nenhum dado pessoal (CPF, telefone, e-mail) aparece em log.
- MySQL roda em Docker na porta **3307** do host, para não colidir com instalação local.
- `DATABASE_URL="mysql://root:sync@localhost:3307/sync"`.
- Enums de domínio (`Channel`, `Intent`, `ConversationStatus`) moram em `packages/contracts` e são a única fonte da verdade. O schema Prisma repete os mesmos valores literais.
- Limiar de aceite de regra: **0.80**. Limiar de escalonamento por baixa confiança: **0.60**.
- Commits em português, prefixo convencional (`feat:`, `test:`, `chore:`, `docs:`).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `package.json`, `tsconfig.base.json`, `biome.json`, `vitest.config.ts` | Workspace e ferramental |
| `docker-compose.yml` | MySQL 8 local |
| `packages/db/prisma/schema.prisma` | Schema do Banco de Contexto |
| `packages/db/src/client.ts` | Instância única do PrismaClient |
| `packages/db/prisma/seed.ts` | Base semeada de clientes, serviços e faturas |
| `packages/contracts/src/enums.ts` | `Channel`, `Intent`, `ConversationStatus`, `Sender`, `Direction` |
| `packages/contracts/src/result.ts` | `Result<T>`, `ok`, `err` |
| `packages/contracts/src/messages.ts` | `InboundMessage` e payloads de canal |
| `apps/api/src/channels/normalizer.ts` | Camada Sync: payload de canal para `InboundMessage` |
| `apps/api/src/nlp/text.ts` | `normalize` |
| `apps/api/src/nlp/pii.ts` | `extractEntities`, `redact` |
| `apps/api/src/nlp/rules.ts` | Tabela de palavras-chave com peso |
| `apps/api/src/nlp/rule-classifier.ts` | `RuleClassifier` |
| `apps/api/src/nlp/types.ts` | `Classification`, `IIntentClassifier` |
| `apps/api/src/conversation/escalation-policy.ts` | `decide`, função pura |
| `apps/api/src/conversation/auto-reply.ts` | `buildAutoReply`, função pura |
| `apps/api/src/context/*.repository.ts` | Repositórios Prisma |
| `apps/api/src/identity/identity.service.ts` | Resolução de cliente |
| `apps/api/src/conversation/orchestrator.ts` | Orquestra o fluxo completo |
| `apps/api/src/gateway/app.ts` | App Express e rotas |
| `apps/api/src/server.ts` | Bootstrap |

---

### Task 1: Workspace, ferramental e banco

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `biome.json`, `vitest.config.ts`, `docker-compose.yml`, `.env.example`, `.env`
- Create: `packages/db/package.json`, `packages/db/prisma/schema.prisma`, `packages/db/src/client.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `import { prisma } from '@sync/db'` devolve um `PrismaClient` conectado ao MySQL local.

- [ ] **Step 1: Criar o workspace raiz**

```bash
npm init -y
npm pkg set name="sync" private=true type="module"
npm pkg set workspaces[0]="packages/*" workspaces[1]="apps/*"
npm pkg set scripts.typecheck="npm run typecheck --workspaces --if-present"
npm pkg set scripts.test="npm run db:seed && vitest run"
npm pkg set scripts.lint="biome check ."
npm pkg set scripts.db:up="docker compose up -d --wait"
npm pkg set scripts.db:migrate="npm -w @sync/db run migrate"
npm pkg set scripts.db:seed="npm -w @sync/db run seed"
npm install -D typescript vitest @biomejs/biome @types/node
```

- [ ] **Step 2: Configurar TypeScript e Biome**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "noEmit": true
  }
}
```

Sem `composite` e sem `declaration` de propósito. Os pacotes internos são consumidos direto do fonte TypeScript, via campo `types` apontando para `src/index.ts`. Cada workspace roda o próprio `tsc --noEmit`; não há passo de build entre eles.

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "files": { "includes": ["**/*.ts", "**/*.tsx", "**/*.json"] },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "asNeeded" } }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/src/**/__tests__/**/*.test.ts'],
    testTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
```

`singleFork` está ligado porque os testes de integração compartilham um único banco MySQL e não podem rodar em paralelo.

- [ ] **Step 3: Subir o MySQL**

`docker-compose.yml`:

```yaml
services:
  mysql:
    image: mysql:8.4
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: sync
      MYSQL_DATABASE: sync
    ports:
      - '3307:3306'
    volumes:
      - sync-mysql:/var/lib/mysql
    healthcheck:
      test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost', '-psync']
      interval: 5s
      timeout: 5s
      retries: 20

volumes:
  sync-mysql:
```

`.env.example` (copie para `.env`, que está no gitignore):

```
DATABASE_URL="mysql://root:sync@localhost:3307/sync"
PORT=3333
```

Run: `npm run db:up`
Expected: container `sync-mysql-1` com status `healthy`.

- [ ] **Step 4: Criar o pacote de banco e o schema**

```bash
mkdir -p packages/db/prisma packages/db/src/__tests__
cd packages/db && npm init -y && cd ../..
npm pkg set -w @sync/db name="@sync/db" type="module" main="./src/index.ts" types="./src/index.ts"
npm pkg set -w @sync/db scripts.typecheck="tsc --noEmit"
npm pkg set -w @sync/db scripts.migrate="prisma migrate dev"
npm pkg set -w @sync/db scripts.seed="tsx prisma/seed.ts"
npm pkg set -w @sync/db scripts.generate="prisma generate"
npm install -w @sync/db @prisma/client
npm install -w @sync/db -D prisma tsx
```

`packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "prisma"]
}
```

`packages/db/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum Channel {
  SITE
  APP
  WHATSAPP
}

enum Intent {
  FATURA_SEGUNDA_VIA
  PROBLEMA_TECNICO
  CONSULTA_PLANO
  CANCELAMENTO
  FALAR_COM_ATENDENTE
  DESCONHECIDA
}

enum ConversationStatus {
  BOT
  WAITING_HUMAN
  WITH_HUMAN
  RESOLVED
}

enum Direction {
  INBOUND
  OUTBOUND
}

enum Sender {
  CUSTOMER
  BOT
  AGENT
}

enum ServiceType {
  INTERNET_RESIDENCIAL
  MOVEL
  TV
}

enum InvoiceStatus {
  OPEN
  PAID
}

enum AgentRole {
  AGENT
  MANAGER
}

model Customer {
  id           String  @id @default(cuid())
  cpf          String  @unique
  name         String
  email        String  @unique
  passwordHash String?
  phone        String? @unique

  services      Service[]
  invoices      Invoice[]
  conversations Conversation[]

  createdAt DateTime @default(now())
}

model Service {
  id         String      @id @default(cuid())
  customerId String
  type       ServiceType
  label      String
  address    String?
  status     String      @default("ACTIVE")

  customer      Customer       @relation(fields: [customerId], references: [id])
  invoices      Invoice[]
  conversations Conversation[]

  @@index([customerId])
}

model Invoice {
  id         String        @id @default(cuid())
  customerId String
  serviceId  String?
  dueDate    DateTime
  amount     Decimal       @db.Decimal(10, 2)
  barcode    String
  status     InvoiceStatus @default(OPEN)

  customer Customer @relation(fields: [customerId], references: [id])
  service  Service? @relation(fields: [serviceId], references: [id])

  @@index([customerId, status])
}

model Conversation {
  id             String             @id @default(cuid())
  protocol       String             @unique
  customerId     String?
  originChannel  Channel
  currentChannel Channel
  intent         Intent?
  serviceId      String?
  status         ConversationStatus @default(BOT)
  stage          String             @default("GREETING")
  collectedData  Json?
  consecutiveUnknown Int            @default(0)
  assignedAgentId String?

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  firstResponseAt DateTime?
  resolvedAt      DateTime?

  customer      Customer?      @relation(fields: [customerId], references: [id])
  service       Service?       @relation(fields: [serviceId], references: [id])
  agent         Agent?         @relation(fields: [assignedAgentId], references: [id])
  messages      Message[]
  handoffTokens HandoffToken[]

  @@index([customerId, status])
  @@index([status, updatedAt])
}

model Message {
  id             String    @id @default(cuid())
  conversationId String
  channel        Channel
  direction      Direction
  sender         Sender
  text           String    @db.Text
  intent         Intent?
  confidence     Float?
  createdAt      DateTime  @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id])

  @@index([conversationId, createdAt])
}

model HandoffToken {
  id             String    @id @default(cuid())
  code           String    @unique
  conversationId String
  targetChannel  Channel
  expiresAt      DateTime
  usedAt         DateTime?

  conversation Conversation @relation(fields: [conversationId], references: [id])
}

model Agent {
  id           String    @id @default(cuid())
  name         String
  email        String    @unique
  passwordHash String
  role         AgentRole @default(AGENT)

  conversations Conversation[]
}

model IntentCache {
  id         String   @id @default(cuid())
  textHash   String   @unique
  intent     Intent
  confidence Float
  entities   Json
  hits       Int      @default(0)
  createdAt  DateTime @default(now())
}
```

- [ ] **Step 5: Rodar a migration**

Run: `npm run db:migrate -- --name inicial`
Expected: pasta `packages/db/prisma/migrations/*_inicial/` criada, sem erro.

- [ ] **Step 6: Expor o cliente**

`packages/db/src/client.ts`:

```ts
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()
```

`packages/db/src/index.ts`:

```ts
export { prisma } from './client.js'
export * from '@prisma/client'
```

- [ ] **Step 7: Escrever o teste de fumaça do schema**

`packages/db/src/__tests__/schema.test.ts`:

```ts
import { afterAll, expect, test } from 'vitest'
import { prisma } from '../client.js'

afterAll(async () => {
  await prisma.$disconnect()
})

test('o banco responde e a tabela Customer existe', async () => {
  const total = await prisma.customer.count()
  expect(total).toBeGreaterThanOrEqual(0)
})
```

- [ ] **Step 8: Rodar o teste**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: workspace, ferramental e schema do banco de contexto"
```

---

### Task 2: Base semeada

**Files:**
- Create: `packages/db/prisma/seed.ts`
- Test: `packages/db/src/__tests__/seed.test.ts`

**Interfaces:**
- Consumes: `prisma` da Task 1
- Produces: cliente com CPF `12345678900`, e-mail `maria.silva@exemplo.com`, telefone `+5511987654321`, um serviço `INTERNET_RESIDENCIAL`, um serviço `MOVEL` rotulado `Plano móvel final 9876`, e uma fatura `OPEN` vencendo em 2026-05-20. Esses valores são os dos três cenários do Documento de Visão e os testes de aceitação dependem deles.

- [ ] **Step 1: Escrever o teste que falha**

`packages/db/src/__tests__/seed.test.ts`:

```ts
import { afterAll, expect, test } from 'vitest'
import { prisma } from '../client.js'

afterAll(async () => {
  await prisma.$disconnect()
})

test('o cliente dos cenários está semeado com serviços e fatura', async () => {
  const cliente = await prisma.customer.findUnique({
    where: { cpf: '12345678900' },
    include: { services: true, invoices: true },
  })

  expect(cliente).not.toBeNull()
  expect(cliente?.phone).toBe('+5511987654321')
  expect(cliente?.services.map((s) => s.type).sort()).toEqual(['INTERNET_RESIDENCIAL', 'MOVEL'])
  expect(cliente?.services.some((s) => s.label === 'Plano móvel final 9876')).toBe(true)

  const aberta = cliente?.invoices.find((i) => i.status === 'OPEN')
  expect(aberta).toBeDefined()
  expect(aberta?.dueDate.toISOString().slice(0, 10)).toBe('2026-05-20')
})
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx vitest run seed`
Expected: FAIL, `expected null not to be null`.

- [ ] **Step 3: Escrever o seed**

`packages/db/prisma/seed.ts`:

```ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const cliente = await prisma.customer.upsert({
    where: { cpf: '12345678900' },
    update: {},
    create: {
      cpf: '12345678900',
      name: 'Maria Silva',
      email: 'maria.silva@exemplo.com',
      phone: '+5511987654321',
    },
  })

  const internet = await prisma.service.upsert({
    where: { id: 'svc-internet-maria' },
    update: {},
    create: {
      id: 'svc-internet-maria',
      customerId: cliente.id,
      type: 'INTERNET_RESIDENCIAL',
      label: 'Claro Net Fibra 500 Mega',
      address: 'Rua das Acácias, 120 - São Paulo/SP',
    },
  })

  await prisma.service.upsert({
    where: { id: 'svc-movel-maria' },
    update: {},
    create: {
      id: 'svc-movel-maria',
      customerId: cliente.id,
      type: 'MOVEL',
      label: 'Plano móvel final 9876',
    },
  })

  await prisma.invoice.upsert({
    where: { id: 'inv-maria-maio' },
    update: {},
    create: {
      id: 'inv-maria-maio',
      customerId: cliente.id,
      serviceId: internet.id,
      dueDate: new Date('2026-05-20T00:00:00.000Z'),
      amount: '149.90',
      barcode: '00000000000 00000000000 00000000000 00000000000',
      status: 'OPEN',
    },
  })

  const segundo = await prisma.customer.upsert({
    where: { cpf: '98765432100' },
    update: {},
    create: {
      cpf: '98765432100',
      name: 'João Pereira',
      email: 'joao.pereira@exemplo.com',
      phone: '+5511912345678',
    },
  })

  await prisma.service.upsert({
    where: { id: 'svc-movel-joao' },
    update: {},
    create: {
      id: 'svc-movel-joao',
      customerId: segundo.id,
      type: 'MOVEL',
      label: 'Plano móvel final 1234',
    },
  })

  console.log('seed concluído')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 4: Rodar o seed e o teste**

Run: `npm run db:seed && npm test -- seed`
Expected: `seed concluído`, depois PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: base semeada com o cliente dos tres cenarios"
```

---

### Task 3: Contratos compartilhados

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/src/enums.ts`, `packages/contracts/src/result.ts`, `packages/contracts/src/messages.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/__tests__/messages.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `Channel = 'SITE' | 'APP' | 'WHATSAPP'`, `Intent`, `ConversationStatus`, `Sender`, `Direction`
  - `Result<T>`, `ok<T>(data): Result<T>`, `err(code, message): Result<never>`
  - `InboundMessage = { channel, text, receivedAt, customerId?, phone?, conversationId?, externalId? }`
  - `webChannelPayloadSchema` valida `{ text, conversationId? }`

- [ ] **Step 1: Criar o pacote**

```bash
mkdir -p packages/contracts/src/__tests__
cd packages/contracts && npm init -y && cd ../..
npm pkg set -w @sync/contracts name="@sync/contracts" type="module" main="./src/index.ts" types="./src/index.ts"
npm pkg set -w @sync/contracts scripts.typecheck="tsc --noEmit"
npm install -w @sync/contracts zod
```

- [ ] **Step 2: Escrever o teste que falha**

`packages/contracts/src/__tests__/messages.test.ts`:

```ts
import { expect, test } from 'vitest'
import { err, ok } from '../result.js'
import { webChannelPayloadSchema } from '../messages.js'

test('aceita payload web válido', () => {
  const r = webChannelPayloadSchema.safeParse({ text: 'minha internet está caindo' })
  expect(r.success).toBe(true)
})

test('rejeita texto vazio', () => {
  const r = webChannelPayloadSchema.safeParse({ text: '' })
  expect(r.success).toBe(false)
})

test('rejeita texto acima de 2000 caracteres', () => {
  const r = webChannelPayloadSchema.safeParse({ text: 'a'.repeat(2001) })
  expect(r.success).toBe(false)
})

test('ok e err produzem o discriminante correto', () => {
  expect(ok(1)).toEqual({ success: true, data: 1 })
  expect(err('X', 'y')).toEqual({ success: false, error: { code: 'X', message: 'y' } })
})
```

- [ ] **Step 3: Rodar o teste para ver falhar**

Run: `npx vitest run contracts`
Expected: FAIL, módulo não encontrado.

- [ ] **Step 4: Implementar**

`packages/contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/contracts/src/enums.ts`:

```ts
export const CHANNELS = ['SITE', 'APP', 'WHATSAPP'] as const
export type Channel = (typeof CHANNELS)[number]

export const INTENTS = [
  'FATURA_SEGUNDA_VIA',
  'PROBLEMA_TECNICO',
  'CONSULTA_PLANO',
  'CANCELAMENTO',
  'FALAR_COM_ATENDENTE',
  'DESCONHECIDA',
] as const
export type Intent = (typeof INTENTS)[number]

export const CONVERSATION_STATUSES = ['BOT', 'WAITING_HUMAN', 'WITH_HUMAN', 'RESOLVED'] as const
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number]

export const SENDERS = ['CUSTOMER', 'BOT', 'AGENT'] as const
export type Sender = (typeof SENDERS)[number]

export const DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const
export type Direction = (typeof DIRECTIONS)[number]
```

`packages/contracts/src/result.ts`:

```ts
export type AppError = { code: string; message: string }

export type Result<T, E = AppError> =
  | { success: true; data: T }
  | { success: false; error: E }

export function ok<T>(data: T): Result<T> {
  return { success: true, data }
}

export function err(code: string, message: string): Result<never> {
  return { success: false, error: { code, message } }
}
```

`packages/contracts/src/messages.ts`:

```ts
import { z } from 'zod'
import { CHANNELS } from './enums.js'

export const webChannelPayloadSchema = z.object({
  text: z.string().min(1).max(2000),
  conversationId: z.string().optional(),
})

export type WebChannelPayload = z.infer<typeof webChannelPayloadSchema>

export const inboundMessageSchema = z.object({
  channel: z.enum(CHANNELS),
  text: z.string().min(1).max(2000),
  receivedAt: z.date(),
  customerId: z.string().optional(),
  phone: z.string().optional(),
  conversationId: z.string().optional(),
  externalId: z.string().optional(),
})

export type InboundMessage = z.infer<typeof inboundMessageSchema>
```

`packages/contracts/src/index.ts`:

```ts
export * from './enums.js'
export * from './result.js'
export * from './messages.js'
```

- [ ] **Step 5: Rodar o teste**

Run: `npm test -- contracts`
Expected: PASS, 4 testes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: contratos compartilhados de enums, Result e mensagens"
```

---

### Task 4: Normalização de texto e extração de PII

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/nlp/text.ts`, `apps/api/src/nlp/pii.ts`
- Test: `apps/api/src/nlp/__tests__/pii.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `normalize(text: string): string` - minúsculas, sem acento, espaços colapsados, sem pontuação de borda
  - `type ExtractedEntities = { cpf?: string; protocol?: string; handoffCode?: string }`
  - `extractEntities(text: string): ExtractedEntities` - CPF em 11 dígitos crus, protocolo em 13 dígitos, código de handoff no formato `SYNC-XXXX`
  - `redact(text: string): string` - substitui CPF por `[CPF]`, telefone por `[TELEFONE]`, e-mail por `[EMAIL]`

Regra de desambiguação adotada: sequências de 11 dígitos no texto são tratadas como **CPF**. Telefone nunca é lido do texto; vem sempre dos metadados do canal. Isso elimina a ambiguidade entre CPF e celular brasileiro, que têm o mesmo comprimento.

- [ ] **Step 1: Criar o app da API**

```bash
mkdir -p apps/api/src/nlp/__tests__
cd apps/api && npm init -y && cd ../..
npm pkg set -w @sync/api name="@sync/api" type="module" main="./src/server.ts"
npm pkg set -w @sync/api scripts.dev="tsx watch src/server.ts"
npm pkg set -w @sync/api dependencies.@sync/contracts="*" dependencies.@sync/db="*"
npm pkg set -w @sync/api scripts.typecheck="tsc --noEmit"
npm install -w @sync/api express zod
npm install
npm install -w @sync/api -D tsx supertest @types/express @types/supertest
```

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 2: Escrever o teste que falha**

`apps/api/src/nlp/__tests__/pii.test.ts`:

```ts
import { expect, test } from 'vitest'
import { extractEntities, redact } from '../pii.js'
import { normalize } from '../text.js'

test('normaliza acentos, caixa e espaços', () => {
  expect(normalize('  Minha INTERNET está  CAINDO ')).toBe('minha internet esta caindo')
})

test('extrai CPF formatado', () => {
  expect(extractEntities('meu cpf é 123.456.789-00').cpf).toBe('12345678900')
})

test('extrai CPF cru', () => {
  expect(extractEntities('12345678900').cpf).toBe('12345678900')
})

test('não extrai CPF de sequência curta', () => {
  expect(extractEntities('meu plano é o 9876').cpf).toBeUndefined()
})

test('extrai protocolo de 13 dígitos', () => {
  expect(extractEntities('protocolo 2026090300123').protocol).toBe('2026090300123')
})

test('extrai código de handoff', () => {
  expect(extractEntities('Continuar atendimento SYNC-A7K2').handoffCode).toBe('SYNC-A7K2')
})

test('redige CPF, telefone e e-mail', () => {
  const saida = redact('cpf 123.456.789-00, fone (11) 98765-4321, mail a@b.com')
  expect(saida).toContain('[CPF]')
  expect(saida).toContain('[TELEFONE]')
  expect(saida).toContain('[EMAIL]')
  expect(saida).not.toContain('123.456.789-00')
  expect(saida).not.toContain('98765-4321')
  expect(saida).not.toContain('a@b.com')
})
```

- [ ] **Step 3: Rodar o teste para ver falhar**

Run: `npx vitest run pii`
Expected: FAIL, módulo não encontrado.

- [ ] **Step 4: Implementar**

`apps/api/src/nlp/text.ts`:

```ts
/** Os combining marks são escritos como escape unicode de propósito: um intervalo
 *  literal de diacríticos no fonte é invisível e quebra em copiar e colar. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
```

`apps/api/src/nlp/pii.ts`:

```ts
export type ExtractedEntities = {
  cpf?: string
  protocol?: string
  handoffCode?: string
}

const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/
const PROTOCOL_RE = /\b\d{13}\b/
const HANDOFF_RE = /\bSYNC-[A-Z0-9]{4}\b/i
const PHONE_RE = /\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g

export function extractEntities(text: string): ExtractedEntities {
  const entidades: ExtractedEntities = {}

  const protocolo = PROTOCOL_RE.exec(text)
  if (protocolo) entidades.protocol = protocolo[0]

  const handoff = HANDOFF_RE.exec(text)
  if (handoff) entidades.handoffCode = handoff[0].toUpperCase()

  const semProtocolo = protocolo ? text.replace(protocolo[0], ' ') : text
  const cpf = CPF_RE.exec(semProtocolo)
  if (cpf) {
    const digitos = cpf[0].replace(/\D/g, '')
    if (digitos.length === 11) entidades.cpf = digitos
  }

  return entidades
}

export function redact(text: string): string {
  return text
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(CPF_RE, '[CPF]')
    .replace(PHONE_RE, '[TELEFONE]')
}
```

A ordem em `redact` importa: e-mail primeiro, porque um e-mail pode conter sequência numérica que casaria com telefone; CPF antes de telefone, porque o padrão de telefone é mais permissivo e engoliria parte do CPF.

- [ ] **Step 5: Rodar o teste**

Run: `npm test -- pii`
Expected: PASS, 7 testes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: normalizacao de texto e extracao de entidades com redacao de PII"
```

---

### Task 5: Classificador por regras

**Files:**
- Create: `apps/api/src/nlp/types.ts`, `apps/api/src/nlp/rules.ts`, `apps/api/src/nlp/rule-classifier.ts`
- Test: `apps/api/src/nlp/__tests__/rule-classifier.test.ts`

**Interfaces:**
- Consumes: `normalize`, `extractEntities` da Task 4; `Intent`, `Result` da Task 3
- Produces:
  - `type Classification = { intent: Intent; confidence: number; entities: ExtractedEntities; source: 'RULES' | 'LLM' | 'CACHE' }`
  - `type ClassifyInput = { text: string }`
  - `interface IIntentClassifier { classify(input: ClassifyInput): Promise<Result<Classification>> }`
  - `class RuleClassifier implements IIntentClassifier`

Fórmula de confiança, derivada da soma de pesos das palavras-chave encontradas:

| Soma | Confiança |
|---|---|
| 0 | 0 (`DESCONHECIDA`) |
| 1 | 0.50 |
| 2 | 0.60 |
| 3 | 0.80 |
| 4 | 0.85 |
| 5 ou mais | 0.90 a 0.95 |

Consequência de projeto: só uma palavra-chave forte (peso 3) leva a confiança ao limiar de aceite de 0.80. Sem ela, a mensagem cai para o LLM na Fase 4, ou para `DESCONHECIDA` agora.

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/nlp/__tests__/rule-classifier.test.ts`:

```ts
import { expect, test } from 'vitest'
import { RuleClassifier } from '../rule-classifier.js'

const classificador = new RuleClassifier()

async function classificar(texto: string) {
  const r = await classificador.classify({ text: texto })
  if (!r.success) throw new Error(r.error.message)
  return r.data
}

test.each([
  ['quero a segunda via da minha fatura', 'FATURA_SEGUNDA_VIA'],
  ['preciso do código de barras do boleto', 'FATURA_SEGUNDA_VIA'],
  ['minha internet está caindo toda hora', 'PROBLEMA_TECNICO'],
  ['o modem não funciona', 'PROBLEMA_TECNICO'],
  ['qual é o meu plano atual', 'CONSULTA_PLANO'],
  ['quero cancelar meu plano', 'CANCELAMENTO'],
  ['quero falar com um atendente', 'FALAR_COM_ATENDENTE'],
])('classifica "%s" como %s', async (texto, esperado) => {
  const c = await classificar(texto)
  expect(c.intent).toBe(esperado)
  expect(c.confidence).toBeGreaterThanOrEqual(0.8)
})

test('cancelamento vence problema técnico quando as duas aparecem', async () => {
  const c = await classificar('quero cancelar minha internet')
  expect(c.intent).toBe('CANCELAMENTO')
})

test('em empate de placar a intenção mais sensível vence', async () => {
  // "cancelar" e "meu plano" valem 3 cada. Sem desempate, ganharia CONSULTA_PLANO
  // só por aparecer antes na tabela de regras, o que seria um erro perigoso.
  const c = await classificar('quero cancelar meu plano')
  expect(c.intent).toBe('CANCELAMENTO')
})

test('texto sem palavra-chave vira DESCONHECIDA com confiança zero', async () => {
  const c = await classificar('bom dia tudo bem com você')
  expect(c.intent).toBe('DESCONHECIDA')
  expect(c.confidence).toBe(0)
})

test('a origem é sempre RULES', async () => {
  const c = await classificar('quero cancelar')
  expect(c.source).toBe('RULES')
})

test('as entidades do texto vêm junto', async () => {
  const c = await classificar('meu cpf é 123.456.789-00 e quero cancelar')
  expect(c.entities.cpf).toBe('12345678900')
})
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx vitest run rule-classifier`
Expected: FAIL, módulo não encontrado.

- [ ] **Step 3: Implementar os tipos**

`apps/api/src/nlp/types.ts`:

```ts
import type { Intent, Result } from '@sync/contracts'
import type { ExtractedEntities } from './pii.js'

export type ClassificationSource = 'RULES' | 'LLM' | 'CACHE'

export type Classification = {
  intent: Intent
  confidence: number
  entities: ExtractedEntities
  source: ClassificationSource
}

export type ClassifyInput = {
  text: string
}

export interface IIntentClassifier {
  classify(input: ClassifyInput): Promise<Result<Classification>>
}
```

- [ ] **Step 4: Implementar a tabela de regras**

`apps/api/src/nlp/rules.ts`:

```ts
import type { Intent } from '@sync/contracts'

export type Rule = { intent: Intent; keyword: string; weight: number }

/** Peso 3 = palavra-chave forte, sozinha basta para aceitar a regra. Peso 1 = indício. */
export const RULES: Rule[] = [
  { intent: 'FATURA_SEGUNDA_VIA', keyword: 'segunda via', weight: 3 },
  { intent: 'FATURA_SEGUNDA_VIA', keyword: '2 via', weight: 3 },
  { intent: 'FATURA_SEGUNDA_VIA', keyword: 'codigo de barras', weight: 3 },
  { intent: 'FATURA_SEGUNDA_VIA', keyword: 'boleto', weight: 3 },
  { intent: 'FATURA_SEGUNDA_VIA', keyword: 'fatura', weight: 3 },
  { intent: 'FATURA_SEGUNDA_VIA', keyword: 'vencimento', weight: 1 },
  { intent: 'FATURA_SEGUNDA_VIA', keyword: 'pagar', weight: 1 },

  { intent: 'PROBLEMA_TECNICO', keyword: 'caindo', weight: 3 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'sem sinal', weight: 3 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'nao funciona', weight: 3 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'instabilidade', weight: 3 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'sem conexao', weight: 3 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'lento', weight: 3 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'internet', weight: 1 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'modem', weight: 1 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'roteador', weight: 1 },

  { intent: 'CONSULTA_PLANO', keyword: 'meu plano', weight: 3 },
  { intent: 'CONSULTA_PLANO', keyword: 'qual plano', weight: 3 },
  { intent: 'CONSULTA_PLANO', keyword: 'franquia', weight: 3 },
  { intent: 'CONSULTA_PLANO', keyword: 'upgrade', weight: 3 },
  { intent: 'CONSULTA_PLANO', keyword: 'pacote', weight: 1 },

  { intent: 'CANCELAMENTO', keyword: 'cancelar', weight: 3 },
  { intent: 'CANCELAMENTO', keyword: 'cancelamento', weight: 3 },
  { intent: 'CANCELAMENTO', keyword: 'rescindir', weight: 3 },
  { intent: 'CANCELAMENTO', keyword: 'encerrar contrato', weight: 3 },
  { intent: 'CANCELAMENTO', keyword: 'portabilidade', weight: 3 },

  { intent: 'FALAR_COM_ATENDENTE', keyword: 'atendente', weight: 3 },
  { intent: 'FALAR_COM_ATENDENTE', keyword: 'falar com humano', weight: 3 },
  { intent: 'FALAR_COM_ATENDENTE', keyword: 'falar com alguem', weight: 3 },
  { intent: 'FALAR_COM_ATENDENTE', keyword: 'pessoa de verdade', weight: 3 },
]
```

- [ ] **Step 5: Implementar o classificador**

`apps/api/src/nlp/rule-classifier.ts`:

```ts
import { type Intent, type Result, ok } from '@sync/contracts'
import { extractEntities } from './pii.js'
import { RULES } from './rules.js'
import { normalize } from './text.js'
import type { Classification, ClassifyInput, IIntentClassifier } from './types.js'

export function confidenceFromScore(score: number): number {
  if (score <= 0) return 0
  if (score < 3) return 0.4 + score * 0.1
  return Math.min(0.8 + (score - 3) * 0.05, 0.95)
}

/** Desempate de placar. Quem aparece antes vence. Intenções sensíveis vêm primeiro:
 *  errar para o lado de escalar é barato, errar para o lado de responder sozinho não. */
const PRIORIDADE: Intent[] = [
  'CANCELAMENTO',
  'FALAR_COM_ATENDENTE',
  'FATURA_SEGUNDA_VIA',
  'PROBLEMA_TECNICO',
  'CONSULTA_PLANO',
  'DESCONHECIDA',
]

function venceEmpate(candidata: Intent, atual: Intent): boolean {
  return PRIORIDADE.indexOf(candidata) < PRIORIDADE.indexOf(atual)
}

export class RuleClassifier implements IIntentClassifier {
  async classify(input: ClassifyInput): Promise<Result<Classification>> {
    const texto = normalize(input.text)
    const placar = new Map<Intent, number>()

    for (const regra of RULES) {
      if (!texto.includes(regra.keyword)) continue
      placar.set(regra.intent, (placar.get(regra.intent) ?? 0) + regra.weight)
    }

    let melhorIntencao: Intent = 'DESCONHECIDA'
    let melhorPlacar = 0
    for (const [intencao, valor] of placar) {
      if (valor > melhorPlacar || (valor === melhorPlacar && venceEmpate(intencao, melhorIntencao))) {
        melhorPlacar = valor
        melhorIntencao = intencao
      }
    }

    return ok({
      intent: melhorIntencao,
      confidence: confidenceFromScore(melhorPlacar),
      entities: extractEntities(input.text),
      source: 'RULES',
    })
  }
}
```

- [ ] **Step 6: Rodar o teste**

Run: `npm test -- rule-classifier`
Expected: PASS, 11 testes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: classificador de intencao por regras com pesos"
```

---

### Task 6: Política de escalonamento

**Files:**
- Create: `apps/api/src/conversation/escalation-policy.ts`
- Test: `apps/api/src/conversation/__tests__/escalation-policy.test.ts`

**Interfaces:**
- Consumes: `Classification` da Task 5
- Produces:
  - `type EscalationReason = 'SENSITIVE_INTENT' | 'CUSTOMER_REQUEST' | 'LOW_CONFIDENCE' | 'REPEATED_UNKNOWN'`
  - `type Decision = { action: 'AUTO_REPLY'; intent: Intent } | { action: 'ESCALATE'; reason: EscalationReason }`
  - `decide(input: { classification: Classification; consecutiveUnknown: number }): Decision`

Ordem das regras, que é o comportamento sob teste:

1. `CANCELAMENTO` escala como `SENSITIVE_INTENT`. Vem do Cenário 2 do Documento de Visão.
2. `FALAR_COM_ATENDENTE` escala como `CUSTOMER_REQUEST`.
3. `DESCONHECIDA` escala como `REPEATED_UNKNOWN` só a partir da segunda vez seguida. Antes disso responde pedindo esclarecimento.
4. Confiança abaixo de 0.60 escala como `LOW_CONFIDENCE`.
5. Caso contrário, resposta automática.

A regra 3 precisa vir antes da 4 porque `DESCONHECIDA` sempre tem confiança 0, e sem essa ordem o cliente nunca teria a chance de reformular.

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/conversation/__tests__/escalation-policy.test.ts`:

```ts
import { expect, test } from 'vitest'
import type { Classification } from '../../nlp/types.js'
import { decide } from '../escalation-policy.js'

function c(intent: Classification['intent'], confidence: number): Classification {
  return { intent, confidence, entities: {}, source: 'RULES' }
}

test('cancelamento sempre escala como intenção sensível', () => {
  expect(decide({ classification: c('CANCELAMENTO', 0.95), consecutiveUnknown: 0 })).toEqual({
    action: 'ESCALATE',
    reason: 'SENSITIVE_INTENT',
  })
})

test('pedido explícito de atendente escala', () => {
  expect(decide({ classification: c('FALAR_COM_ATENDENTE', 0.9), consecutiveUnknown: 0 })).toEqual({
    action: 'ESCALATE',
    reason: 'CUSTOMER_REQUEST',
  })
})

test('primeira mensagem desconhecida pede esclarecimento em vez de escalar', () => {
  expect(decide({ classification: c('DESCONHECIDA', 0), consecutiveUnknown: 0 })).toEqual({
    action: 'AUTO_REPLY',
    intent: 'DESCONHECIDA',
  })
})

test('segunda mensagem desconhecida seguida escala', () => {
  expect(decide({ classification: c('DESCONHECIDA', 0), consecutiveUnknown: 2 })).toEqual({
    action: 'ESCALATE',
    reason: 'REPEATED_UNKNOWN',
  })
})

test('confiança abaixo de 0.60 escala', () => {
  expect(decide({ classification: c('PROBLEMA_TECNICO', 0.5), consecutiveUnknown: 0 })).toEqual({
    action: 'ESCALATE',
    reason: 'LOW_CONFIDENCE',
  })
})

test('confiança exatamente 0.60 não escala', () => {
  expect(decide({ classification: c('PROBLEMA_TECNICO', 0.6), consecutiveUnknown: 0 })).toEqual({
    action: 'AUTO_REPLY',
    intent: 'PROBLEMA_TECNICO',
  })
})

test('intenção resolvível com alta confiança responde automaticamente', () => {
  expect(decide({ classification: c('FATURA_SEGUNDA_VIA', 0.9), consecutiveUnknown: 0 })).toEqual({
    action: 'AUTO_REPLY',
    intent: 'FATURA_SEGUNDA_VIA',
  })
})
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx vitest run escalation-policy`
Expected: FAIL, módulo não encontrado.

- [ ] **Step 3: Implementar**

`apps/api/src/conversation/escalation-policy.ts`:

```ts
import type { Intent } from '@sync/contracts'
import type { Classification } from '../nlp/types.js'

export const LOW_CONFIDENCE_THRESHOLD = 0.6
export const MAX_CONSECUTIVE_UNKNOWN = 2

export type EscalationReason =
  | 'SENSITIVE_INTENT'
  | 'CUSTOMER_REQUEST'
  | 'LOW_CONFIDENCE'
  | 'REPEATED_UNKNOWN'

export type Decision =
  | { action: 'AUTO_REPLY'; intent: Intent }
  | { action: 'ESCALATE'; reason: EscalationReason }

export type DecideInput = {
  classification: Classification
  consecutiveUnknown: number
}

export function decide({ classification, consecutiveUnknown }: DecideInput): Decision {
  const { intent, confidence } = classification

  if (intent === 'CANCELAMENTO') {
    return { action: 'ESCALATE', reason: 'SENSITIVE_INTENT' }
  }

  if (intent === 'FALAR_COM_ATENDENTE') {
    return { action: 'ESCALATE', reason: 'CUSTOMER_REQUEST' }
  }

  if (intent === 'DESCONHECIDA') {
    return consecutiveUnknown >= MAX_CONSECUTIVE_UNKNOWN
      ? { action: 'ESCALATE', reason: 'REPEATED_UNKNOWN' }
      : { action: 'AUTO_REPLY', intent: 'DESCONHECIDA' }
  }

  if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    return { action: 'ESCALATE', reason: 'LOW_CONFIDENCE' }
  }

  return { action: 'AUTO_REPLY', intent }
}
```

- [ ] **Step 4: Rodar o teste**

Run: `npm test -- escalation-policy`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: politica de escalonamento como funcao pura"
```

---

### Task 7: Geração de resposta automática

**Files:**
- Create: `apps/api/src/conversation/auto-reply.ts`
- Test: `apps/api/src/conversation/__tests__/auto-reply.test.ts`

**Interfaces:**
- Consumes: `Intent` da Task 3
- Produces:
  - `type ReplyContext = { customerName?: string; openInvoice?: { dueDate: Date; barcode: string }; services: { type: string; label: string }[]; identified: boolean }`
  - `buildAutoReply(intent: Intent, ctx: ReplyContext): string`
  - `buildEscalationReply(reason: EscalationReason): string`

Função pura, sem I/O. O orquestrador carrega os dados e passa prontos.

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/conversation/__tests__/auto-reply.test.ts`:

```ts
import { expect, test } from 'vitest'
import { type ReplyContext, buildAutoReply, buildEscalationReply } from '../auto-reply.js'

const identificado: ReplyContext = {
  customerName: 'Maria Silva',
  identified: true,
  openInvoice: { dueDate: new Date('2026-05-20T00:00:00.000Z'), barcode: '0000 1111 2222' },
  services: [{ type: 'INTERNET_RESIDENCIAL', label: 'Claro Net Fibra 500 Mega' }],
}

const anonimo: ReplyContext = { identified: false, services: [] }

test('fatura identificada cita o vencimento', () => {
  const r = buildAutoReply('FATURA_SEGUNDA_VIA', identificado)
  expect(r).toContain('20/05')
})

test('fatura sem identificação pede CPF ou login', () => {
  const r = buildAutoReply('FATURA_SEGUNDA_VIA', anonimo)
  expect(r.toLowerCase()).toContain('cpf')
})

test('problema técnico identificado cita o serviço', () => {
  const r = buildAutoReply('PROBLEMA_TECNICO', identificado)
  expect(r).toContain('Claro Net Fibra 500 Mega')
})

test('consulta de plano lista os serviços', () => {
  const r = buildAutoReply('CONSULTA_PLANO', identificado)
  expect(r).toContain('Claro Net Fibra 500 Mega')
})

test('desconhecida pede reformulação sem culpar o cliente', () => {
  const r = buildAutoReply('DESCONHECIDA', identificado)
  expect(r.toLowerCase()).toContain('não entendi')
})

test('escalonamento por intenção sensível avisa que o histórico vai junto', () => {
  const r = buildEscalationReply('SENSITIVE_INTENT')
  expect(r.toLowerCase()).toContain('histórico')
})

test('nenhuma resposta contém CPF cru', () => {
  for (const intent of ['FATURA_SEGUNDA_VIA', 'PROBLEMA_TECNICO', 'CONSULTA_PLANO'] as const) {
    expect(buildAutoReply(intent, identificado)).not.toMatch(/\d{11}/)
  }
})
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx vitest run auto-reply`
Expected: FAIL, módulo não encontrado.

- [ ] **Step 3: Implementar**

`apps/api/src/conversation/auto-reply.ts`:

```ts
import type { Intent } from '@sync/contracts'
import type { EscalationReason } from './escalation-policy.js'

export type ReplyContext = {
  customerName?: string
  identified: boolean
  openInvoice?: { dueDate: Date; barcode: string }
  services: { type: string; label: string }[]
}

function formatarData(data: Date): string {
  const dia = String(data.getUTCDate()).padStart(2, '0')
  const mes = String(data.getUTCMonth() + 1).padStart(2, '0')
  return `${dia}/${mes}`
}

const PEDIR_IDENTIFICACAO =
  'Para localizar seu cadastro, você pode informar seu CPF ou fazer login na sua conta Claro.'

export function buildAutoReply(intent: Intent, ctx: ReplyContext): string {
  if (!ctx.identified && intent !== 'DESCONHECIDA') {
    return `Entendi seu pedido. ${PEDIR_IDENTIFICACAO}`
  }

  switch (intent) {
    case 'FATURA_SEGUNDA_VIA': {
      if (!ctx.openInvoice) {
        return 'Não encontrei nenhuma fatura em aberto no seu cadastro. Quer consultar faturas anteriores?'
      }
      return `Localizei sua fatura em aberto com vencimento em ${formatarData(ctx.openInvoice.dueDate)}. Deseja receber o código de barras ou baixar o PDF?`
    }

    case 'PROBLEMA_TECNICO': {
      const servico = ctx.services.find((s) => s.type === 'INTERNET_RESIDENCIAL') ?? ctx.services[0]
      const alvo = servico ? ` no serviço ${servico.label}` : ''
      return `Identifiquei que sua solicitação é sobre instabilidade de conexão${alvo}. Posso fazer uma verificação inicial por aqui. O modem está ligado e com as luzes de internet piscando?`
    }

    case 'CONSULTA_PLANO': {
      if (ctx.services.length === 0) {
        return 'Não encontrei serviços ativos no seu cadastro. Quer que eu verifique com um atendente?'
      }
      const lista = ctx.services.map((s) => `- ${s.label}`).join('\n')
      return `Estes são os serviços ativos no seu cadastro:\n${lista}\n\nQuer detalhes de algum deles?`
    }

    default:
      return 'Não entendi bem o seu pedido. Você pode reformular? Posso ajudar com fatura, problema técnico ou consulta de plano.'
  }
}

export function buildEscalationReply(reason: EscalationReason): string {
  switch (reason) {
    case 'SENSITIVE_INTENT':
      return 'Como essa solicitação precisa de validação adicional, vou direcionar você para um atendente. Ele receberá o histórico desta conversa, então você não precisará explicar tudo novamente.'
    case 'CUSTOMER_REQUEST':
      return 'Claro. Vou transferir você para um atendente agora. Ele já vai receber o histórico desta conversa.'
    case 'REPEATED_UNKNOWN':
      return 'Prefiro não te fazer repetir mais. Vou chamar um atendente, e ele receberá o histórico desta conversa.'
    case 'LOW_CONFIDENCE':
      return 'Quero garantir que você seja bem atendido. Vou passar para um atendente com o histórico desta conversa.'
  }
}
```

- [ ] **Step 4: Rodar o teste**

Run: `npm test -- auto-reply`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: geracao de resposta automatica e de escalonamento"
```

---

### Task 8: Repositórios do Banco de Contexto

**Files:**
- Create: `apps/api/src/context/protocol.ts`, `apps/api/src/context/conversation.repository.ts`, `apps/api/src/context/message.repository.ts`, `apps/api/src/context/customer.repository.ts`, `apps/api/src/context/index.ts`
- Test: `apps/api/src/context/__tests__/conversation.repository.test.ts`

**Interfaces:**
- Consumes: `prisma` da Task 1; enums da Task 3
- Produces:
  - `generateProtocol(now: Date): string` - 13 dígitos, `YYYYMMDD` mais 5 aleatórios
  - `interface IConversationRepository` com `findById`, `findOpenByCustomer`, `create`, `update`
  - `interface IMessageRepository` com `append`, `listByConversation`
  - `interface ICustomerRepository` com `findById`, `findByCpf`, `findByPhone`, `findWithContext`
  - `PrismaConversationRepository`, `PrismaMessageRepository`, `PrismaCustomerRepository`

"Conversa aberta" significa status diferente de `RESOLVED`.

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/context/__tests__/conversation.repository.test.ts`:

```ts
import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { PrismaConversationRepository } from '../conversation.repository.js'
import { PrismaMessageRepository } from '../message.repository.js'
import { generateProtocol } from '../protocol.js'

const conversas = new PrismaConversationRepository(prisma)
const mensagens = new PrismaMessageRepository(prisma)

beforeEach(async () => {
  await prisma.message.deleteMany()
  await prisma.handoffToken.deleteMany()
  await prisma.conversation.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

test('o protocolo tem 13 dígitos e começa pela data', () => {
  const p = generateProtocol(new Date('2026-09-03T10:00:00.000Z'))
  expect(p).toHaveLength(13)
  expect(p.startsWith('20260903')).toBe(true)
})

test('cria conversa com protocolo único e status inicial BOT', async () => {
  const c = await conversas.create({ originChannel: 'SITE', currentChannel: 'SITE' })
  expect(c.status).toBe('BOT')
  expect(c.protocol).toHaveLength(13)
})

test('encontra a conversa aberta do cliente e ignora as resolvidas', async () => {
  const cliente = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })

  const resolvida = await conversas.create({
    originChannel: 'SITE',
    currentChannel: 'SITE',
    customerId: cliente.id,
  })
  await conversas.update(resolvida.id, { status: 'RESOLVED', resolvedAt: new Date() })

  const aberta = await conversas.create({
    originChannel: 'APP',
    currentChannel: 'APP',
    customerId: cliente.id,
  })

  const achada = await conversas.findOpenByCustomer(cliente.id)
  expect(achada?.id).toBe(aberta.id)
})

test('mensagens voltam em ordem cronológica', async () => {
  const c = await conversas.create({ originChannel: 'SITE', currentChannel: 'SITE' })

  await mensagens.append({
    conversationId: c.id,
    channel: 'SITE',
    direction: 'INBOUND',
    sender: 'CUSTOMER',
    text: 'primeira',
  })
  await mensagens.append({
    conversationId: c.id,
    channel: 'SITE',
    direction: 'OUTBOUND',
    sender: 'BOT',
    text: 'segunda',
  })

  const lista = await mensagens.listByConversation(c.id)
  expect(lista.map((m) => m.text)).toEqual(['primeira', 'segunda'])
})
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx vitest run conversation.repository`
Expected: FAIL, módulo não encontrado.

- [ ] **Step 3: Implementar o gerador de protocolo**

`apps/api/src/context/protocol.ts`:

```ts
export function generateProtocol(now: Date = new Date()): string {
  const ano = now.getUTCFullYear()
  const mes = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(now.getUTCDate()).padStart(2, '0')
  const sufixo = String(Math.floor(Math.random() * 100_000)).padStart(5, '0')
  return `${ano}${mes}${dia}${sufixo}`
}
```

- [ ] **Step 4: Implementar os repositórios**

`apps/api/src/context/conversation.repository.ts`:

```ts
import type { Channel, ConversationStatus, Intent } from '@sync/contracts'
import type { Conversation, PrismaClient } from '@sync/db'
import { generateProtocol } from './protocol.js'

export type CreateConversationInput = {
  originChannel: Channel
  currentChannel: Channel
  customerId?: string
}

export type UpdateConversationInput = {
  customerId?: string
  currentChannel?: Channel
  intent?: Intent
  serviceId?: string
  status?: ConversationStatus
  stage?: string
  collectedData?: Record<string, unknown>
  consecutiveUnknown?: number
  firstResponseAt?: Date
  resolvedAt?: Date
}

export interface IConversationRepository {
  findById(id: string): Promise<Conversation | null>
  findByProtocol(protocol: string): Promise<Conversation | null>
  findOpenByCustomer(customerId: string): Promise<Conversation | null>
  create(input: CreateConversationInput): Promise<Conversation>
  update(id: string, patch: UpdateConversationInput): Promise<Conversation>
}

const MAX_TENTATIVAS_PROTOCOLO = 5

export class PrismaConversationRepository implements IConversationRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string): Promise<Conversation | null> {
    return this.db.conversation.findUnique({ where: { id } })
  }

  findByProtocol(protocol: string): Promise<Conversation | null> {
    return this.db.conversation.findUnique({ where: { protocol } })
  }

  findOpenByCustomer(customerId: string): Promise<Conversation | null> {
    return this.db.conversation.findFirst({
      where: { customerId, status: { not: 'RESOLVED' } },
      orderBy: { updatedAt: 'desc' },
    })
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    for (let tentativa = 0; tentativa < MAX_TENTATIVAS_PROTOCOLO; tentativa++) {
      try {
        return await this.db.conversation.create({
          data: { ...input, protocol: generateProtocol() },
        })
      } catch (erro) {
        const colisao =
          typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002'
        if (!colisao) throw erro
      }
    }
    throw new Error('não foi possível gerar um protocolo único')
  }

  update(id: string, patch: UpdateConversationInput): Promise<Conversation> {
    const { collectedData, ...resto } = patch
    return this.db.conversation.update({
      where: { id },
      data: collectedData ? { ...resto, collectedData } : resto,
    })
  }
}
```

`apps/api/src/context/message.repository.ts`:

```ts
import type { Channel, Direction, Intent, Sender } from '@sync/contracts'
import type { Message, PrismaClient } from '@sync/db'

export type CreateMessageInput = {
  conversationId: string
  channel: Channel
  direction: Direction
  sender: Sender
  text: string
  intent?: Intent
  confidence?: number
}

export interface IMessageRepository {
  append(input: CreateMessageInput): Promise<Message>
  listByConversation(conversationId: string): Promise<Message[]>
}

export class PrismaMessageRepository implements IMessageRepository {
  constructor(private readonly db: PrismaClient) {}

  append(input: CreateMessageInput): Promise<Message> {
    return this.db.message.create({ data: input })
  }

  listByConversation(conversationId: string): Promise<Message[]> {
    return this.db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    })
  }
}
```

`apps/api/src/context/customer.repository.ts`:

```ts
import type { Customer, Invoice, PrismaClient, Service } from '@sync/db'

export type CustomerWithContext = Customer & {
  services: Service[]
  invoices: Invoice[]
}

export interface ICustomerRepository {
  findById(id: string): Promise<Customer | null>
  findByCpf(cpf: string): Promise<Customer | null>
  findByPhone(phone: string): Promise<Customer | null>
  findWithContext(id: string): Promise<CustomerWithContext | null>
}

export class PrismaCustomerRepository implements ICustomerRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string): Promise<Customer | null> {
    return this.db.customer.findUnique({ where: { id } })
  }

  findByCpf(cpf: string): Promise<Customer | null> {
    return this.db.customer.findUnique({ where: { cpf } })
  }

  findByPhone(phone: string): Promise<Customer | null> {
    return this.db.customer.findUnique({ where: { phone } })
  }

  findWithContext(id: string): Promise<CustomerWithContext | null> {
    return this.db.customer.findUnique({
      where: { id },
      include: {
        services: true,
        invoices: { where: { status: 'OPEN' }, orderBy: { dueDate: 'asc' } },
      },
    })
  }
}
```

`apps/api/src/context/index.ts`:

```ts
export * from './conversation.repository.js'
export * from './customer.repository.js'
export * from './message.repository.js'
export * from './protocol.js'
```

- [ ] **Step 5: Rodar o teste**

Run: `npm test -- conversation.repository`
Expected: PASS, 4 testes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: repositorios do banco de contexto"
```

---

### Task 9: Serviço de Identificação

**Files:**
- Create: `apps/api/src/identity/identity.service.ts`
- Test: `apps/api/src/identity/__tests__/identity.service.test.ts`

**Interfaces:**
- Consumes: `ICustomerRepository`, `IConversationRepository` da Task 8
- Produces:
  - `type IdentifyInput = { customerId?: string; phone?: string; cpf?: string; protocol?: string }`
  - `interface IIdentityService { identify(input: IdentifyInput): Promise<Customer | null> }`
  - `class IdentityService implements IIdentityService`

Ordem de resolução, da fonte mais confiável para a menos: `customerId` (vem do token autenticado), `phone` (vem dos metadados do WhatsApp, não do texto), `cpf` (informado no diálogo), `protocol` (busca a conversa e volta ao cliente dela).

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/identity/__tests__/identity.service.test.ts`:

```ts
import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { PrismaConversationRepository } from '../../context/conversation.repository.js'
import { PrismaCustomerRepository } from '../../context/customer.repository.js'
import { IdentityService } from '../identity.service.js'

const servico = new IdentityService(
  new PrismaCustomerRepository(prisma),
  new PrismaConversationRepository(prisma),
)

beforeEach(async () => {
  await prisma.message.deleteMany()
  await prisma.handoffToken.deleteMany()
  await prisma.conversation.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

test('resolve por customerId', async () => {
  const esperado = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const achado = await servico.identify({ customerId: esperado.id })
  expect(achado?.id).toBe(esperado.id)
})

test('resolve por telefone', async () => {
  const achado = await servico.identify({ phone: '+5511987654321' })
  expect(achado?.cpf).toBe('12345678900')
})

test('resolve por CPF', async () => {
  const achado = await servico.identify({ cpf: '12345678900' })
  expect(achado?.name).toBe('Maria Silva')
})

test('resolve por protocolo de conversa anterior', async () => {
  const cliente = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const conversa = await new PrismaConversationRepository(prisma).create({
    originChannel: 'SITE',
    currentChannel: 'SITE',
    customerId: cliente.id,
  })

  const achado = await servico.identify({ protocol: conversa.protocol })
  expect(achado?.id).toBe(cliente.id)
})

test('customerId tem prioridade sobre CPF conflitante', async () => {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const achado = await servico.identify({ customerId: maria.id, cpf: '98765432100' })
  expect(achado?.id).toBe(maria.id)
})

test('devolve null quando nada resolve', async () => {
  expect(await servico.identify({ cpf: '00000000000' })).toBeNull()
  expect(await servico.identify({})).toBeNull()
})
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx vitest run identity.service`
Expected: FAIL, módulo não encontrado.

- [ ] **Step 3: Implementar**

`apps/api/src/identity/identity.service.ts`:

```ts
import type { Customer } from '@sync/db'
import type { IConversationRepository } from '../context/conversation.repository.js'
import type { ICustomerRepository } from '../context/customer.repository.js'

export type IdentifyInput = {
  customerId?: string
  phone?: string
  cpf?: string
  protocol?: string
}

export interface IIdentityService {
  identify(input: IdentifyInput): Promise<Customer | null>
}

export class IdentityService implements IIdentityService {
  constructor(
    private readonly customers: ICustomerRepository,
    private readonly conversations: IConversationRepository,
  ) {}

  async identify(input: IdentifyInput): Promise<Customer | null> {
    if (input.customerId) {
      const porId = await this.customers.findById(input.customerId)
      if (porId) return porId
    }

    if (input.phone) {
      const porTelefone = await this.customers.findByPhone(input.phone)
      if (porTelefone) return porTelefone
    }

    if (input.cpf) {
      const porCpf = await this.customers.findByCpf(input.cpf)
      if (porCpf) return porCpf
    }

    if (input.protocol) {
      const conversa = await this.conversations.findByProtocol(input.protocol)
      if (conversa?.customerId) return this.customers.findById(conversa.customerId)
    }

    return null
  }
}
```

- [ ] **Step 4: Rodar o teste**

Run: `npm test -- identity.service`
Expected: PASS, 6 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: servico de identificacao por id, telefone, cpf e protocolo"
```

---

### Task 10: Camada Sync (normalizador de canal)

**Files:**
- Create: `apps/api/src/channels/normalizer.ts`
- Test: `apps/api/src/channels/__tests__/normalizer.test.ts`

**Interfaces:**
- Consumes: `InboundMessage`, `webChannelPayloadSchema`, `Result` da Task 3
- Produces:
  - `type AuthContext = { customerId?: string }`
  - `normalizeWebPayload(channel: Channel, body: unknown, auth: AuthContext, now: Date): Result<InboundMessage>`

Este é o componente "Camada Sync - entrada normalizada" do diagrama de arquitetura. É o único lugar que conhece o formato bruto de cada canal. O adapter da Meta entra aqui na Fase 5, sem mexer em mais nada.

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/channels/__tests__/normalizer.test.ts`:

```ts
import { expect, test } from 'vitest'
import { normalizeWebPayload } from '../normalizer.js'

const agora = new Date('2026-09-03T12:00:00.000Z')

test('normaliza payload do site', () => {
  const r = normalizeWebPayload('SITE', { text: 'oi' }, {}, agora)
  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data).toEqual({ channel: 'SITE', text: 'oi', receivedAt: agora })
})

test('propaga customerId do contexto autenticado', () => {
  const r = normalizeWebPayload('APP', { text: 'oi' }, { customerId: 'abc' }, agora)
  expect(r.success && r.data.customerId).toBe('abc')
})

test('propaga conversationId do payload', () => {
  const r = normalizeWebPayload('SITE', { text: 'oi', conversationId: 'c1' }, {}, agora)
  expect(r.success && r.data.conversationId).toBe('c1')
})

test('rejeita payload sem texto com código de erro', () => {
  const r = normalizeWebPayload('SITE', {}, {}, agora)
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('PAYLOAD_INVALIDO')
})

test('rejeita canal WhatsApp por esta porta', () => {
  const r = normalizeWebPayload('WHATSAPP', { text: 'oi' }, {}, agora)
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('CANAL_INVALIDO')
})
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx vitest run normalizer`
Expected: FAIL, módulo não encontrado.

- [ ] **Step 3: Implementar**

`apps/api/src/channels/normalizer.ts`:

```ts
import {
  type Channel,
  type InboundMessage,
  type Result,
  err,
  ok,
  webChannelPayloadSchema,
} from '@sync/contracts'

export type AuthContext = { customerId?: string }

const CANAIS_WEB: Channel[] = ['SITE', 'APP']

export function normalizeWebPayload(
  channel: Channel,
  body: unknown,
  auth: AuthContext,
  now: Date = new Date(),
): Result<InboundMessage> {
  if (!CANAIS_WEB.includes(channel)) {
    return err('CANAL_INVALIDO', 'Este canal não entra pela porta web.')
  }

  const parsed = webChannelPayloadSchema.safeParse(body)
  if (!parsed.success) {
    return err('PAYLOAD_INVALIDO', 'Mensagem inválida. O texto é obrigatório.')
  }

  const mensagem: InboundMessage = {
    channel,
    text: parsed.data.text,
    receivedAt: now,
  }
  if (parsed.data.conversationId) mensagem.conversationId = parsed.data.conversationId
  if (auth.customerId) mensagem.customerId = auth.customerId

  return ok(mensagem)
}
```

- [ ] **Step 4: Rodar o teste**

Run: `npm test -- normalizer`
Expected: PASS, 5 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: camada sync de normalizacao de entrada dos canais web"
```

---

### Task 11: Orquestrador de conversação

**Files:**
- Create: `apps/api/src/conversation/orchestrator.ts`
- Test: `apps/api/src/conversation/__tests__/orchestrator.test.ts`

**Interfaces:**
- Consumes: tudo das Tasks 5 a 10
- Produces:
  - `type HandleResult = { conversationId: string; protocol: string; reply: string; intent: Intent; status: ConversationStatus }`
  - `class ConversationOrchestrator { handle(msg: InboundMessage): Promise<Result<HandleResult>> }`

Sequência interna, que segue o diagrama de sequência do Documento de Visão:

1. Identifica o cliente com `customerId`, `phone` e o CPF extraído do texto
2. Carrega a conversa: por `conversationId`, senão a aberta do cliente, senão cria
3. Grava a mensagem de entrada
4. Classifica a intenção
5. Atualiza o contexto (intenção, contador de desconhecidas, dados coletados)
6. Decide entre resposta automática e escalonamento
7. Grava a mensagem de saída
8. Devolve o resultado

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/conversation/__tests__/orchestrator.test.ts`:

```ts
import type { InboundMessage } from '@sync/contracts'
import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import {
  PrismaConversationRepository,
  PrismaCustomerRepository,
  PrismaMessageRepository,
} from '../../context/index.js'
import { IdentityService } from '../../identity/identity.service.js'
import { RuleClassifier } from '../../nlp/rule-classifier.js'
import { ConversationOrchestrator } from '../orchestrator.js'

const conversas = new PrismaConversationRepository(prisma)
const mensagens = new PrismaMessageRepository(prisma)
const clientes = new PrismaCustomerRepository(prisma)

const orquestrador = new ConversationOrchestrator(
  new IdentityService(clientes, conversas),
  conversas,
  mensagens,
  clientes,
  new RuleClassifier(),
)

function entrada(text: string, extra: Partial<InboundMessage> = {}): InboundMessage {
  return { channel: 'SITE', text, receivedAt: new Date(), ...extra }
}

beforeEach(async () => {
  await prisma.message.deleteMany()
  await prisma.handoffToken.deleteMany()
  await prisma.conversation.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

test('mensagem anônima cria conversa e pede identificação', async () => {
  const r = await orquestrador.handle(entrada('minha internet está caindo'))
  expect(r.success).toBe(true)
  if (!r.success) return

  expect(r.data.intent).toBe('PROBLEMA_TECNICO')
  expect(r.data.status).toBe('BOT')
  expect(r.data.reply.toLowerCase()).toContain('cpf')
  expect(r.data.protocol).toHaveLength(13)
})

test('cliente autenticado recebe resposta contextualizada sem pedir CPF', async () => {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const r = await orquestrador.handle(
    entrada('minha internet está caindo', { customerId: maria.id }),
  )
  expect(r.success).toBe(true)
  if (!r.success) return

  expect(r.data.reply).toContain('Claro Net Fibra 500 Mega')
  expect(r.data.reply.toLowerCase()).not.toContain('informar seu cpf')
})

test('as duas mensagens ficam gravadas na ordem certa', async () => {
  const r = await orquestrador.handle(entrada('quero a segunda via da fatura'))
  if (!r.success) throw new Error('falhou')

  const lista = await mensagens.listByConversation(r.data.conversationId)
  expect(lista).toHaveLength(2)
  expect(lista[0]?.direction).toBe('INBOUND')
  expect(lista[0]?.intent).toBe('FATURA_SEGUNDA_VIA')
  expect(lista[1]?.direction).toBe('OUTBOUND')
  expect(lista[1]?.sender).toBe('BOT')
})

test('cancelamento marca a conversa como aguardando humano', async () => {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const r = await orquestrador.handle(entrada('quero cancelar meu plano', { customerId: maria.id }))
  expect(r.success).toBe(true)
  if (!r.success) return

  expect(r.data.status).toBe('WAITING_HUMAN')
  expect(r.data.reply.toLowerCase()).toContain('histórico')

  const conversa = await conversas.findById(r.data.conversationId)
  expect(conversa?.status).toBe('WAITING_HUMAN')
})

test('a segunda mensagem continua na mesma conversa do cliente', async () => {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })

  const primeira = await orquestrador.handle(
    entrada('minha internet está caindo', { customerId: maria.id }),
  )
  const segunda = await orquestrador.handle(
    entrada('quero a segunda via da fatura', { customerId: maria.id }),
  )

  if (!primeira.success || !segunda.success) throw new Error('falhou')
  expect(segunda.data.conversationId).toBe(primeira.data.conversationId)

  const lista = await mensagens.listByConversation(primeira.data.conversationId)
  expect(lista).toHaveLength(4)
})

test('CPF informado no texto identifica o cliente na mesma mensagem', async () => {
  const r = await orquestrador.handle(entrada('meu cpf é 123.456.789-00, quero ver meu plano'))
  if (!r.success) throw new Error('falhou')

  const conversa = await conversas.findById(r.data.conversationId)
  expect(conversa?.customerId).not.toBeNull()
  expect(r.data.reply).toContain('Plano móvel final 9876')
})

test('duas mensagens desconhecidas seguidas escalam', async () => {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })

  const primeira = await orquestrador.handle(entrada('bom dia', { customerId: maria.id }))
  if (!primeira.success) throw new Error('falhou')
  expect(primeira.data.status).toBe('BOT')

  const segunda = await orquestrador.handle(entrada('tudo certo por aí', { customerId: maria.id }))
  if (!segunda.success) throw new Error('falhou')
  expect(segunda.data.status).toBe('WAITING_HUMAN')
})
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx vitest run orchestrator`
Expected: FAIL, módulo não encontrado.

- [ ] **Step 3: Implementar**

`apps/api/src/conversation/orchestrator.ts`:

```ts
import type {
  ConversationStatus,
  InboundMessage,
  Intent,
  Result,
} from '@sync/contracts'
import { err, ok } from '@sync/contracts'
import type { Conversation, Customer } from '@sync/db'
import type {
  IConversationRepository,
  ICustomerRepository,
  IMessageRepository,
} from '../context/index.js'
import type { IIdentityService } from '../identity/identity.service.js'
import { extractEntities } from '../nlp/pii.js'
import type { IIntentClassifier } from '../nlp/types.js'
import { type ReplyContext, buildAutoReply, buildEscalationReply } from './auto-reply.js'
import { decide } from './escalation-policy.js'

export type HandleResult = {
  conversationId: string
  protocol: string
  reply: string
  intent: Intent
  status: ConversationStatus
}

export class ConversationOrchestrator {
  constructor(
    private readonly identity: IIdentityService,
    private readonly conversations: IConversationRepository,
    private readonly messages: IMessageRepository,
    private readonly customers: ICustomerRepository,
    private readonly classifier: IIntentClassifier,
  ) {}

  async handle(msg: InboundMessage): Promise<Result<HandleResult>> {
    const entidades = extractEntities(msg.text)

    const cliente = await this.identity.identify({
      customerId: msg.customerId,
      phone: msg.phone,
      cpf: entidades.cpf,
      protocol: entidades.protocol,
    })

    const conversa = await this.loadOrCreate(msg, cliente)

    // A mensagem de entrada só é gravada depois da classificação, para já nascer
    // com intent e confidence preenchidos. Gravar antes exigiria um update logo em
    // seguida e deixaria uma linha sem intenção caso a classificação falhasse.
    const classificado = await this.classifier.classify({ text: msg.text })
    if (!classificado.success) {
      return err('CLASSIFICACAO_FALHOU', 'Não foi possível interpretar a mensagem.')
    }
    const classificacao = classificado.data

    await this.messages.append({
      conversationId: conversa.id,
      channel: msg.channel,
      direction: 'INBOUND',
      sender: 'CUSTOMER',
      text: msg.text,
      intent: classificacao.intent,
      confidence: classificacao.confidence,
    })

    const desconhecidasSeguidas =
      classificacao.intent === 'DESCONHECIDA' ? conversa.consecutiveUnknown + 1 : 0

    const decisao = decide({
      classification: classificacao,
      consecutiveUnknown: desconhecidasSeguidas,
    })

    const contexto = await this.buildReplyContext(cliente)
    const resposta =
      decisao.action === 'AUTO_REPLY'
        ? buildAutoReply(decisao.intent, contexto)
        : buildEscalationReply(decisao.reason)

    const status: ConversationStatus = decisao.action === 'ESCALATE' ? 'WAITING_HUMAN' : 'BOT'

    const atualizada = await this.conversations.update(conversa.id, {
      intent: classificacao.intent,
      status,
      consecutiveUnknown: desconhecidasSeguidas,
      currentChannel: msg.channel,
      ...(cliente && !conversa.customerId ? { customerId: cliente.id } : {}),
      ...(conversa.firstResponseAt ? {} : { firstResponseAt: new Date() }),
    })

    await this.messages.append({
      conversationId: conversa.id,
      channel: msg.channel,
      direction: 'OUTBOUND',
      sender: 'BOT',
      text: resposta,
      intent: classificacao.intent,
      confidence: classificacao.confidence,
    })

    return ok({
      conversationId: atualizada.id,
      protocol: atualizada.protocol,
      reply: resposta,
      intent: classificacao.intent,
      status,
    })
  }

  private async loadOrCreate(msg: InboundMessage, cliente: Customer | null): Promise<Conversation> {
    if (msg.conversationId) {
      const porId = await this.conversations.findById(msg.conversationId)
      if (porId) return porId
    }

    if (cliente) {
      const aberta = await this.conversations.findOpenByCustomer(cliente.id)
      if (aberta) return aberta
    }

    return this.conversations.create({
      originChannel: msg.channel,
      currentChannel: msg.channel,
      ...(cliente ? { customerId: cliente.id } : {}),
    })
  }

  private async buildReplyContext(cliente: Customer | null): Promise<ReplyContext> {
    if (!cliente) return { identified: false, services: [] }

    const completo = await this.customers.findWithContext(cliente.id)
    if (!completo) return { identified: false, services: [] }

    const aberta = completo.invoices[0]

    return {
      identified: true,
      customerName: completo.name,
      services: completo.services.map((s) => ({ type: s.type, label: s.label })),
      ...(aberta ? { openInvoice: { dueDate: aberta.dueDate, barcode: aberta.barcode } } : {}),
    }
  }
}
```

- [ ] **Step 4: Rodar o teste**

Run: `npm test -- orchestrator`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: orquestrador de conversacao ligando identificacao, nlp e contexto"
```

---

### Task 12: Gateway HTTP

**Files:**
- Create: `apps/api/src/gateway/container.ts`, `apps/api/src/gateway/app.ts`, `apps/api/src/server.ts`
- Test: `apps/api/src/gateway/__tests__/app.test.ts`

**Interfaces:**
- Consumes: `ConversationOrchestrator` da Task 11, `normalizeWebPayload` da Task 10
- Produces:
  - `buildContainer(): { orchestrator: ConversationOrchestrator }` - raiz de composição
  - `createApp(deps: { orchestrator: ConversationOrchestrator }): Express`
  - Rotas: `GET /health`, `POST /api/channels/:channel/messages`

Contrato da rota de mensagens:

| Situação | Status | Corpo |
|---|---|---|
| Sucesso | 200 | `{ conversationId, protocol, reply, intent, status }` |
| Canal desconhecido na URL | 400 | `{ error: { code: 'CANAL_INVALIDO', message } }` |
| Payload inválido | 400 | `{ error: { code: 'PAYLOAD_INVALIDO', message } }` |
| Falha interna | 500 | `{ error: { code: 'ERRO_INTERNO', message } }` |

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/gateway/__tests__/app.test.ts`:

```ts
import { prisma } from '@sync/db'
import request from 'supertest'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { createApp } from '../app.js'
import { buildContainer } from '../container.js'

const app = createApp(buildContainer())

beforeEach(async () => {
  await prisma.message.deleteMany()
  await prisma.handoffToken.deleteMany()
  await prisma.conversation.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

test('GET /health responde ok', async () => {
  const r = await request(app).get('/health')
  expect(r.status).toBe(200)
  expect(r.body).toEqual({ status: 'ok' })
})

test('POST de mensagem do site devolve resposta e protocolo', async () => {
  const r = await request(app)
    .post('/api/channels/site/messages')
    .send({ text: 'minha internet está caindo' })

  expect(r.status).toBe(200)
  expect(r.body.intent).toBe('PROBLEMA_TECNICO')
  expect(r.body.protocol).toHaveLength(13)
  expect(typeof r.body.reply).toBe('string')
})

test('canal desconhecido devolve 400', async () => {
  const r = await request(app).post('/api/channels/telegram/messages').send({ text: 'oi' })
  expect(r.status).toBe(400)
  expect(r.body.error.code).toBe('CANAL_INVALIDO')
})

test('payload sem texto devolve 400', async () => {
  const r = await request(app).post('/api/channels/site/messages').send({})
  expect(r.status).toBe(400)
  expect(r.body.error.code).toBe('PAYLOAD_INVALIDO')
})

test('a conversa continua quando o conversationId é reenviado', async () => {
  const primeira = await request(app)
    .post('/api/channels/site/messages')
    .send({ text: 'minha internet está caindo' })

  const segunda = await request(app)
    .post('/api/channels/site/messages')
    .send({ text: 'quero a segunda via da fatura', conversationId: primeira.body.conversationId })

  expect(segunda.body.conversationId).toBe(primeira.body.conversationId)
})
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx vitest run gateway`
Expected: FAIL, módulo não encontrado.

- [ ] **Step 3: Implementar a raiz de composição**

`apps/api/src/gateway/container.ts`:

```ts
import { prisma } from '@sync/db'
import {
  PrismaConversationRepository,
  PrismaCustomerRepository,
  PrismaMessageRepository,
} from '../context/index.js'
import { ConversationOrchestrator } from '../conversation/orchestrator.js'
import { IdentityService } from '../identity/identity.service.js'
import { RuleClassifier } from '../nlp/rule-classifier.js'

export type Container = {
  orchestrator: ConversationOrchestrator
}

export function buildContainer(): Container {
  const conversations = new PrismaConversationRepository(prisma)
  const messages = new PrismaMessageRepository(prisma)
  const customers = new PrismaCustomerRepository(prisma)
  const identity = new IdentityService(customers, conversations)

  return {
    orchestrator: new ConversationOrchestrator(
      identity,
      conversations,
      messages,
      customers,
      new RuleClassifier(),
    ),
  }
}
```

- [ ] **Step 4: Implementar o app Express**

`apps/api/src/gateway/app.ts`:

```ts
import { CHANNELS, type Channel } from '@sync/contracts'
import express, { type Express, type Request, type Response } from 'express'
import { normalizeWebPayload } from '../channels/normalizer.js'
import type { Container } from './container.js'

function parseChannel(raw: string): Channel | null {
  const upper = raw.toUpperCase()
  return (CHANNELS as readonly string[]).includes(upper) ? (upper as Channel) : null
}

export function createApp(deps: Container): Express {
  const app = express()
  app.use(express.json())

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' })
  })

  app.post('/api/channels/:channel/messages', async (req: Request, res: Response) => {
    const channel = parseChannel(req.params.channel ?? '')
    if (!channel) {
      res.status(400).json({
        error: { code: 'CANAL_INVALIDO', message: 'Canal não reconhecido.' },
      })
      return
    }

    const normalizado = normalizeWebPayload(channel, req.body, {})
    if (!normalizado.success) {
      res.status(400).json({ error: normalizado.error })
      return
    }

    try {
      const resultado = await deps.orchestrator.handle(normalizado.data)
      if (!resultado.success) {
        res.status(500).json({ error: resultado.error })
        return
      }
      res.json(resultado.data)
    } catch {
      res.status(500).json({
        error: { code: 'ERRO_INTERNO', message: 'Não foi possível processar a mensagem.' },
      })
    }
  })

  return app
}
```

- [ ] **Step 5: Implementar o bootstrap**

`apps/api/src/server.ts`:

```ts
import { createApp } from './gateway/app.js'
import { buildContainer } from './gateway/container.js'

const porta = Number(process.env.PORT ?? 3333)

createApp(buildContainer()).listen(porta, () => {
  console.log(`sync api ouvindo em http://localhost:${porta}`)
})
```

- [ ] **Step 6: Rodar o teste**

Run: `npm test -- gateway`
Expected: PASS, 5 testes.

- [ ] **Step 7: Rodar a suíte inteira e o typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck sem erro, todos os testes verdes.

- [ ] **Step 8: Verificar manualmente**

Run: `npm -w @sync/api run dev` e, em outro terminal:

```bash
curl -s -X POST http://localhost:3333/api/channels/site/messages \
  -H 'content-type: application/json' \
  -d '{"text":"minha internet esta caindo"}'
```

Expected: JSON com `intent: "PROBLEMA_TECNICO"`, um `protocol` de 13 dígitos e uma `reply` pedindo CPF.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: gateway http com rota de mensagens dos canais web"
```

---

## O que este plano entrega

Ao final da Task 12, o núcleo do Sync está funcionando:

- Uma mensagem de site ou app entra pela Camada Sync, é validada e normalizada
- O cliente é identificado por token, telefone, CPF no texto ou protocolo
- A intenção é classificada por regras com confiança calibrada
- O contexto é persistido em MySQL com protocolo, histórico e etapa
- A política de escalonamento decide entre responder ou chamar humano
- A resposta volta contextualizada com os dados reais do cliente

## O que fica para os próximos planos

| Plano | Fases | Conteúdo |
|---|---|---|
| 2 | 2 e 3 | Módulo `auth` (primeiro acesso, login, refresh com rotação), front do site em React |
| 3 | 4 a 8 | Gemini com cache e redação, handoff, WhatsApp via Meta Cloud API, painel administrativo, front do app, indicadores, os 3 cenários como testes de aceitação |

O endpoint SSE (`GET /api/conversations/:id/stream`) entra no Plano 3, junto com o painel administrativo, porque só faz sentido quando existe um atendente humano capaz de responder de forma assíncrona. Até lá, o ciclo requisição e resposta do `POST` já entrega a conversa completa.
