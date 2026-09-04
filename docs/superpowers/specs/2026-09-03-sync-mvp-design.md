# Sync - Design do MVP

**Projeto:** Sync (Challenge 2026 FIAP 4SI / Claro)
**Time:** Sync Unit - Leticia Vitalino (552481), Gustavo Ressurreição (550983), Bruno de Castro (551411), Isaac Destro (97847)
**Data:** 2026-09-03
**Status:** aguardando revisão

---

## 1. Objetivo

Construir uma camada intermediária de integração conversacional entre os canais digitais da Claro (site, app, WhatsApp) e os serviços de atendimento, de forma que o cliente consiga iniciar um atendimento em um canal e continuar em outro sem repetir informações.

Este documento é o design técnico derivado dos entregáveis da Sprint 2 (Documento de Visão da Solução e Documentação Técnica). Ele traduz os requisitos e diagramas daqueles documentos em decisões de implementação.

## 2. Decisões travadas

| Tema | Decisão | Motivo |
|---|---|---|
| Alvo de entrega | MVP funcional com testes | Base real para evolução, não só demo |
| Stack base | React + Node.js + REST + MySQL | Contrato com o documento entregue |
| Ferramental em volta | TypeScript, Prisma, Zod, Vitest, npm workspaces | Qualidade sem fugir da stack documentada |
| Backend | Monolito modular | Cabe no prazo; cada caixa do diagrama vira módulo isolado atrás de interface |
| NLP | Híbrido: regras, LLM (Gemini), cache | Resiliência de demo sem abrir mão de IA real |
| Canais de cliente | 3 apps web: site, app, admin | Escolha explícita do time |
| WhatsApp | Meta Cloud API real, com adapter mock de fallback | Handoff para o WhatsApp real do avaliador |
| Transporte tempo real | SSE sobre HTTP | Continua sendo REST; um mecanismo serve chat e admin |
| Login do cliente | Autenticação real: Argon2id, JWT, refresh com rotação | Identificação de verdade no site e app; sem simulação |

## 3. Escopo

### Dentro

- Recebimento de mensagens de site, app e WhatsApp (RF001)
- Identificação do cliente por login, telefone, CPF ou protocolo (RF002)
- Classificação automática de intenção (RF003)
- Persistência de contexto: histórico, canal, intenção, etapa (RF004)
- Continuidade entre canais sem repetição (RF005)
- Roteamento para atendente humano (RF006)
- Interface administrativa com fila, histórico, dados e status (RF007)
- Registro de status do atendimento (RF008)

### Fora

- Outros canais (redes sociais, e-mail, loja física, central telefônica)
- Substituição do atendimento humano
- Integração com sistemas legados reais da Claro (usamos base própria semeada)
- Perfil completo e definitivo do cliente
- Templates de mensagem aprovados pela Meta para envio fora da janela de 24h

## 4. Arquitetura

### 4.1 Mapeamento diagrama para código

O diagrama da Documentação Técnica tem 7 componentes. Cada um vira um módulo com interface própria dentro de um único processo Node.

| Componente do diagrama | Módulo | Responsabilidade |
|---|---|---|
| Site / App / WhatsApp Claro | `apps/web-site`, `apps/web-app`, `channels/adapters` | Entrada |
| Camada Sync (entrada normalizada) | `channels/normalizer` | Converte payload de qualquer canal em `InboundMessage` |
| API Gateway | `gateway` | Roteia, valida, autentica, aplica rate limit |
| Identificação | `identity` | Resolve cliente por login, telefone, CPF ou protocolo |
| Conversação | `conversation` | Orquestra o diálogo e decide a próxima ação |
| Motor NLP / IA | `nlp` | Classifica intenção e extrai entidades |
| Banco de Contexto | `context` | Repositórios de conversa, mensagem, cliente |
| Interface Atendente | `admin` + `apps/web-admin` | Fila, detalhe, resposta, resolução |
| Retorno ao Canal | `channels/dispatcher` | Ponto único de saída para qualquer canal |

O deploy é único **por decisão de escopo do MVP**. As fronteiras entre módulos são interfaces TypeScript, então extrair qualquer um para um serviço separado depois é mecânico.

### 4.2 Estrutura de pastas

A raiz do repositório é a pasta atual (`tulipe/`). O nome da pasta não muda nada; o nome do projeto nos `package.json` é `sync`.

```
<raiz>/
├── apps/
│   ├── api/                    Node 24 + Express 5 + TypeScript
│   │   └── src/
│   │       ├── channels/       normalizer, adapters (site, app, whatsapp), dispatcher
│   │       ├── gateway/        rotas, middlewares, validação Zod, rate limit
│   │       ├── auth/           login de cliente e de atendente, JWT, Argon2id
│   │       ├── identity/       resolução de cliente
│   │       ├── conversation/   orquestração do diálogo, política de escalonamento
│   │       ├── nlp/            regras, cliente Gemini, cache, redação de PII
│   │       ├── context/        repositórios Prisma
│   │       ├── admin/          fila, tickets, métricas, auth de atendente
│   │       └── shared/         Result<T>, erros, logger, config
│   ├── web-site/               React 19 + Vite - chat do site Claro
│   ├── web-app/                React 19 + Vite - chat do app Claro
│   └── web-admin/              React 19 + Vite - painel do atendente
├── packages/
│   ├── contracts/              tipos e schemas Zod compartilhados api <-> front
│   ├── chat-ui/                componente de chat reutilizado pelos 3 canais
│   └── db/                     schema Prisma, migrations, seed
├── docs/
├── docker-compose.yml          MySQL 8
└── package.json                npm workspaces
```

### 4.3 Fluxo de uma mensagem

Segue o diagrama de sequência do Documento de Visão:

```
1. Cliente envia mensagem em linguagem natural
2. Canal encaminha para POST /api/channels/:channel/messages
3. Camada Sync normaliza -> InboundMessage
4. Gateway valida e roteia
5. Identity resolve o cliente (ou marca como não identificado)
6. Context carrega conversa aberta + histórico
7. NLP classifica intenção e extrai entidades
8. Context atualiza a conversa (intenção, etapa, dados coletados)
9. Conversation decide:
      simples   -> gera resposta automática
      complexa  -> marca WAITING_HUMAN e entra na fila do admin
10. Dispatcher devolve a resposta pelo canal de origem
```

Passo 9 é o único ponto de decisão. Ele é isolado numa `EscalationPolicy` testável em separado.

## 5. Modelo de dados

```prisma
model Customer {
  id           String   @id @default(cuid())
  cpf          String   @unique
  name         String
  email        String   @unique
  passwordHash String?            // null = primeiro acesso ainda não feito
  phone        String?  @unique   // E.164, chave de identificação no WhatsApp
  services  Service[]
  invoices  Invoice[]
  conversations Conversation[]
}

model Service {
  id         String      @id @default(cuid())
  customerId String
  type       ServiceType // INTERNET_RESIDENCIAL | MOVEL | TV
  label      String      // "Plano móvel final 9876"
  address    String?
  status     String
}

model Invoice {
  id        String   @id @default(cuid())
  customerId String
  serviceId String?
  dueDate   DateTime
  amount    Decimal
  barcode   String
  status    InvoiceStatus // OPEN | PAID
}

model Conversation {
  id             String   @id @default(cuid())
  protocol       String   @unique   // "2026090300123", serve de protocolo ao cliente
  customerId     String?             // null até identificar
  originChannel  Channel             // SITE | APP | WHATSAPP
  currentChannel Channel
  intent         Intent?
  serviceId      String?             // serviço relacionado
  status         ConversationStatus  // BOT | WAITING_HUMAN | WITH_HUMAN | RESOLVED
  stage          String              // etapa atual do fluxo
  collectedData  Json                // { cpf, problema, ... } dados já informados
  assignedAgentId String?
  firstResponseAt DateTime?
  resolvedAt      DateTime?
  messages       Message[]
}

model Message {
  id             String    @id @default(cuid())
  conversationId String
  channel        Channel
  direction      Direction // INBOUND | OUTBOUND
  sender         Sender    // CUSTOMER | BOT | AGENT
  text           String    @db.Text
  intent         Intent?
  confidence     Float?
  createdAt      DateTime  @default(now())
}

model HandoffToken {
  id             String   @id @default(cuid())
  code           String   @unique  // "SYNC-A7K2"
  conversationId String
  targetChannel  Channel
  expiresAt      DateTime
  usedAt         DateTime?
}

model Agent {
  id           String @id @default(cuid())
  name         String
  email        String @unique
  passwordHash String
  role         AgentRole // AGENT | MANAGER
}

model IntentCache {
  id         String   @id @default(cuid())
  textHash   String   @unique  // SHA-256 do texto normalizado e redigido
  intent     Intent
  confidence Float
  entities   Json
  hits       Int      @default(0)
}
```

**Sobre "ticket":** o Fluxo Interno do documento fala em ticket. Aqui o ticket **é** a `Conversation` com status `WAITING_HUMAN` ou `WITH_HUMAN`. Não existe tabela separada. O campo `protocol` cumpre o papel de número de ticket visível ao cliente e também é um dos meios de identificação previstos no RF002.

## 6. Taxonomia de intenções

```
FATURA_SEGUNDA_VIA     segunda via, código de barras, boleto, PDF
PROBLEMA_TECNICO       internet caindo, sem sinal, lentidão, modem
CONSULTA_PLANO         qual meu plano, franquia, upgrade, valor
CANCELAMENTO           cancelar, rescindir, encerrar contrato
FALAR_COM_ATENDENTE    quero falar com humano, atendente, pessoa
DESCONHECIDA           fallback
```

Simplificação assumida: "suporte de internet", listado à parte na Documentação Técnica, é `PROBLEMA_TECNICO` com `serviceId` apontando para um serviço do tipo `INTERNET_RESIDENCIAL`. Não vira intenção separada.

## 7. Motor NLP

### 7.1 Pipeline

```
classify(text, context):
  1. normaliza          lowercase, remove acentos, colapsa espaços
  2. redige PII         CPF, telefone e e-mail viram placeholders
  3. cache lookup       SHA-256 do texto redigido -> hit? retorna
  4. regras             scoring por palavra-chave. confidence >= 0.80? retorna e grava no cache
  5. Gemini             structured output: { intent, confidence, entities }
  6. grava no cache
  7. erro na chamada    retorna o melhor palpite das regras com confidence rebaixada
```

O passo 2 existe por causa do RNF001 e da LGPD. Nada de CPF sai da nossa infra para o Gemini. As entidades (CPF, telefone, protocolo) são extraídas por regex **antes** da chamada, localmente.

### 7.2 Interface

```typescript
interface IIntentClassifier {
  classify(input: ClassifyInput): Promise<Result<Classification>>
}
```

Três implementações: `RuleClassifier`, `GeminiClassifier`, `HybridClassifier` (compõe as outras duas mais o cache). Testes usam `RuleClassifier` ou um stub, nunca a rede.

## 8. Política de escalonamento

Vai para humano quando:

- intenção é `CANCELAMENTO` (sensível, conforme Cenário 2 do documento)
- intenção é `FALAR_COM_ATENDENTE`
- intenção é `DESCONHECIDA` por 2 mensagens seguidas
- confiança final abaixo de 0.60

Resolve automaticamente: `FATURA_SEGUNDA_VIA`, `CONSULTA_PLANO`, `PROBLEMA_TECNICO` (checagem inicial guiada).

Isolada em `EscalationPolicy.decide(conversation, classification): Decision`. Função pura, sem I/O, testada por tabela de casos.

## 9. Canais

### 9.1 Site e App

Chat web atrás de autenticação real de cliente. Ambos consomem `packages/chat-ui`; muda só a casca visual e o `channel` enviado.

**Modelo de conta.** A base é semeada com clientes que já existem (CPF, nome, e-mail, serviços, faturas), sem senha. É o mesmo modelo da Claro real: você é cliente antes de ter login. Não há cadastro aberto, porque uma conta criada do zero não teria plano nem fatura para conversar a respeito.

**Primeiro acesso.** O cliente informa CPF e e-mail. Se o par bate com um registro semeado, ele define a senha e `passwordHash` é preenchido.

**Login.** E-mail e senha. Devolve JWT de acesso (15 min) e refresh com rotação. O `customerId` do token vira o identificador da conversa, o que cobre o "Já estou logado" do Cenário 1 sem pedir CPF.

**Chat anônimo.** Continua permitido. Sem token, a conversa começa com `customerId` null e o `identity` resolve por CPF informado no diálogo. É o caminho de quem entra no site sem logar.

O módulo `auth` serve os dois públicos, cliente e atendente, com a mesma mecânica de hash e token. Muda só o repositório consultado e o `role` dentro do JWT.

### 9.2 WhatsApp

```typescript
interface IWhatsAppChannel {
  send(to: string, text: string): Promise<Result<void>>
  parseWebhook(body: unknown): Result<InboundMessage[]>
}
```

- `MetaCloudAdapter` - WhatsApp Business Cloud API, número de teste da Meta. Principal.
- `MockAdapter` - tela web com aparência de WhatsApp. Fallback offline e desenvolvimento.

Selecionado por `WHATSAPP_DRIVER=meta|mock`.

Webhook em `POST /api/webhooks/whatsapp` com verificação de assinatura `X-Hub-Signature-256`. `GET` no mesmo path responde ao desafio de verificação da Meta.

### 9.3 Handoff site para WhatsApp

```
1. Conversation decide oferecer continuidade
2. POST /api/conversations/:id/handoff { target: "whatsapp" }
3. Backend gera HandoffToken code="SYNC-A7K2", expira em 15 min
4. Devolve https://wa.me/<numero>?text=Continuar%20atendimento%20SYNC-A7K2
5. Cliente abre o WhatsApp real e envia
6. Webhook da Meta chega no backend
7. Backend acha o token no texto, vincula a conversa, marca usedAt
8. currentChannel vira WHATSAPP, contexto intacto
9. Bot responde retomando de onde parou
```

Se o cliente voltar depois sem token (Cenário 3), a identificação é pelo telefone do webhook. O backend procura conversa aberta do cliente e retoma.

**Limites do número de teste da Meta:** até 5 destinatários cadastrados; janela de resposta livre de 24h após mensagem do cliente; token de acesso permanente via System User.

## 10. API

### Públicas

```
POST /api/channels/:channel/messages     envia mensagem do cliente
GET  /api/conversations/:id/stream       SSE com respostas do bot e do atendente
POST /api/conversations/:id/handoff      gera link de continuidade
POST /api/auth/first-access              valida CPF + e-mail e define senha
POST /api/auth/login                     e-mail e senha, devolve access + refresh
POST /api/auth/refresh                   rotaciona o refresh token
POST /api/auth/logout                    revoga a família do refresh
GET  /api/auth/me                        cliente autenticado, serviços e faturas
GET  /api/webhooks/whatsapp              verificação da Meta
POST /api/webhooks/whatsapp              recebimento de mensagens
```

### Administrativas (autenticadas)

```
POST /api/admin/auth/login
GET  /api/admin/conversations            filtros: status, channel, intent
GET  /api/admin/conversations/:id
POST /api/admin/conversations/:id/claim
POST /api/admin/conversations/:id/messages
POST /api/admin/conversations/:id/resolve
GET  /api/admin/metrics
GET  /api/admin/stream                   SSE de novos tickets
```

Todo payload validado com Zod. Schemas moram em `packages/contracts` e são importados pelo backend e pelos fronts, então o contrato é o mesmo tipo dos dois lados.

## 11. Interface administrativa

Cobre as 8 funcionalidades da tabela do Documento de Visão:

| Requisito do documento | Implementação |
|---|---|
| Lista de atendimentos | Tabela com colunas protocolo, cliente, canal, intenção, status, espera |
| Filtro por canal | Query param `channel` |
| Filtro por intenção | Query param `intent` |
| Histórico da conversa | Painel de detalhe com todas as mensagens e o remetente |
| Dados do cliente | Cartão com nome, CPF mascarado, serviço relacionado, dados coletados |
| Status do atendimento | Badge: em andamento, aguardando humano, com atendente, resolvido |
| Ação do atendente | Assumir, responder, finalizar |
| Indicadores | Painel de métricas (seção 12) |

O painel de detalhe reproduz exatamente os campos do Cenário 2: cliente, canal de origem, intenção detectada, serviço relacionado, status e histórico.

## 12. Indicadores

- Total de atendimentos por status
- Taxa de resolução automática (resolvidos sem humano / total)
- Tempo médio até a primeira resposta
- Tempo médio de atendimento
- Distribuição por canal e por intenção
- **Continuidades entre canais** - o KPI que justifica o projeto. Contado como conversas onde `originChannel != currentChannel`, ou que têm ao menos um `HandoffToken` com `usedAt` preenchido

## 13. Segurança e LGPD (RNF001)

- Autenticação de cliente e de atendente com JWT e hash Argon2id, no mesmo módulo `auth`
- Access token de 15 min, refresh com rotação e rastreio de família (reuso de refresh revoga a família inteira)
- Rate limit agressivo em login e primeiro acesso
- Mensagens de erro de login não distinguem e-mail inexistente de senha errada, para não permitir enumeração de contas
- CPF mascarado em log e na interface (`***.456.789-**`)
- Redação de PII antes de qualquer chamada ao LLM
- Chave de cache é hash do texto redigido, nunca o texto cru
- Verificação de assinatura no webhook da Meta
- Rate limit nos endpoints públicos
- Segredos só em variáveis de ambiente, `.env` fora do git

## 14. Testes

| Nível | Ferramenta | Alvo |
|---|---|---|
| Unitário | Vitest | Regras de intenção, política de escalonamento, normalizador, geração e consumo de token |
| Integração | Vitest + Supertest + MySQL em Docker | Rotas da API contra banco real |
| Segurança | Vitest + Supertest | Primeiro acesso com par CPF e e-mail errado, rotação e reuso de refresh token, rate limit, ausência de enumeração de contas |
| Ponta a ponta | Vitest + Supertest | Os 3 cenários do Documento de Visão |
| Componente | Vitest + Testing Library | `chat-ui` e telas do admin |

Os três cenários ilustrativos do documento viram testes de aceitação nomeados. Isso amarra a implementação ao entregável da Sprint 2 e dá um argumento direto na banca.

Chamadas de rede (Gemini, Meta) nunca acontecem em teste. Sempre stub.

## 15. Fases de implementação

| Fase | Entrega | Verificável por |
|---|---|---|
| 0 | Monorepo, Docker Compose com MySQL, Prisma schema, seed | `npm run db:seed` popula clientes, serviços e faturas |
| 1 | Núcleo do backend com classificador de regras apenas | Teste de integração: mensagem entra, intenção sai, contexto grava |
| 2 | Módulo `auth`: primeiro acesso, login, refresh com rotação, para cliente e atendente | Suíte de segurança verde |
| 3 | Front do site: tela de login real mais chat ponta a ponta | Conversa autenticada real no navegador |
| 4 | Gemini, cache e redação de PII | Teste unitário do pipeline; frase fora das regras classifica certo |
| 5 | Handoff e WhatsApp real via Meta | Cenário 1 completo no celular |
| 6 | Painel administrativo | Cenário 2 completo |
| 7 | Front do app, indicadores, acabamento | Cenário 3 completo |
| 8 | Os 3 cenários como testes automatizados, deploy | Suíte verde |

A Fase 5 depende de configuração externa (conta de desenvolvedor Meta, número de teste, números de destino cadastrados, túnel HTTPS). Vale começar essa configuração em paralelo à Fase 1, porque tem tempo de espera que não depende de código nenhum.

## 16. Riscos

| Risco | Mitigação |
|---|---|
| Número de teste da Meta aceita só 5 destinatários | Cadastrar os 4 do time mais o professor antes da apresentação |
| Internet cair no dia | `WHATSAPP_DRIVER=mock` reproduz a jornada inteira offline |
| Quota do Gemini estourar | Cache aquecido; regras cobrem o caminho feliz sem chamar a rede |
| Token da Meta expirar em 24h | Gerar token permanente de System User na Fase 4 |
| Escopo crescer | Qualquer coisa fora da seção 3 vai para backlog pós-MVP |

## 17. Premissas assumidas

Estas decisões não estavam nos documentos e foram tomadas aqui. Se alguma estiver errada, é barato mudar agora e caro depois.

1. Ticket e Conversation são a mesma entidade, diferenciadas por status.
2. "Suporte de internet" não é intenção própria; é `PROBLEMA_TECNICO` com serviço do tipo internet.
3. Não existe integração com sistema real da Claro. Clientes, serviços e faturas vêm de uma base semeada nossa.
4. Não existe cadastro aberto de cliente. A base é semeada e o cliente faz "primeiro acesso" para definir senha, validando CPF e e-mail contra um registro que já existe. Chat sem login continua permitido, com identificação por CPF no diálogo.
5. SSE atende o requisito de "REST API" do documento, por ser HTTP puro.
6. Limiar de confiança para escalonar é 0.60 e para aceitar regra é 0.80. Ambos ajustáveis por configuração.
