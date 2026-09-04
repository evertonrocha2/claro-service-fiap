import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { AdminService } from '../../admin/admin.service.js'
import {
  PrismaConversationRepository,
  PrismaCustomerRepository,
  PrismaMessageRepository,
} from '../../context/index.js'
import { ConversationOrchestrator } from '../../conversation/orchestrator.js'
import { IdentityService } from '../../identity/identity.service.js'
import { RuleClassifier } from '../../nlp/rule-classifier.js'
import {
  GeminiCardSummary,
  type ICardSummaryWriter,
  limparTitulo,
} from '../card-summary.service.js'

/**
 * Titulo do cartao escrito pela IA.
 *
 * Nenhum teste toca a rede: o fetch e injetado. O que interessa provar e o
 * contorno do recurso, e nao o texto que o modelo devolve:
 *
 * - o cartao usa o titulo quando ele existe
 * - sem IA o cartao volta a mostrar a mensagem crua
 * - a conversa do cliente nao muda em nenhum dos dois casos
 */

const conversas = new PrismaConversationRepository(prisma)
const mensagens = new PrismaMessageRepository(prisma)
const clientes = new PrismaCustomerRepository(prisma)
const admin = new AdminService(prisma, mensagens)

function orquestrador(escritor?: ICardSummaryWriter) {
  return new ConversationOrchestrator(
    new IdentityService(clientes, conversas),
    conversas,
    mensagens,
    clientes,
    new RuleClassifier(),
    undefined,
    escritor,
  )
}

/** Escritor de mentira: devolve o que mandarmos, sem sair da maquina. */
function escritorFixo(titulo: string | null): ICardSummaryWriter & { chamadas: string[] } {
  const chamadas: string[] = []
  return {
    chamadas,
    async write(text: string) {
      chamadas.push(text)
      return titulo
    },
  }
}

function respostaDoGemini(texto: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: texto }] } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
}

beforeEach(async () => {
  await prisma.offerInsight.deleteMany()
  await prisma.message.deleteMany()
  await prisma.handoffToken.deleteMany()
  await prisma.conversation.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

// ---------- limpeza do que o modelo devolve ----------

test('tira aspas, ponto final e linha extra do titulo', () => {
  // O modelo entrega assim mesmo, apesar da instrucao.
  expect(limparTitulo('"Internet caindo desde ontem."')).toBe('Internet caindo desde ontem')
  expect(limparTitulo('Segunda via da fatura\n\nposso ajudar em algo mais?')).toBe(
    'Segunda via da fatura',
  )
  expect(limparTitulo('  Cancelamento de plano  ')).toBe('Cancelamento de plano')
})

test('corta titulo longo em vez de deixar estourar o cartao', () => {
  const longo = limparTitulo('a'.repeat(200))
  expect(longo?.length).toBeLessThanOrEqual(70)
  expect(longo?.endsWith('…')).toBe(true)
})

test('resposta vazia nao vira titulo', () => {
  expect(limparTitulo('')).toBeNull()
  expect(limparTitulo('\n \n')).toBeNull()
})

// ---------- o cliente nao vai ao Gemini ----------

test('o texto sai redigido: CPF nao chega ao modelo', async () => {
  // Mesma regra do classificador. Um titulo bonito nao justifica mandar CPF
  // para fora daqui.
  let enviado = ''
  const escritor = new GeminiCardSummary({
    apiKey: 'irrelevante-no-teste',
    fetchImpl: (async (_url: string, init: RequestInit) => {
      enviado = String(init.body)
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Segunda via' }] } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch,
  })

  await escritor.write('meu cpf e 123.456.789-00, quero a segunda via')

  expect(enviado).not.toContain('123.456.789-00')
  expect(enviado).toContain('[CPF]')
})

test('modelo fora do ar devolve null, e nao explode', async () => {
  const escritor = new GeminiCardSummary({
    apiKey: 'irrelevante-no-teste',
    fetchImpl: (async () => new Response('erro', { status: 503 })) as unknown as typeof fetch,
  })

  expect(await escritor.write('minha internet caiu')).toBeNull()
})

test('resposta do modelo chega limpa ate o titulo', async () => {
  const escritor = new GeminiCardSummary({
    apiKey: 'irrelevante-no-teste',
    fetchImpl: respostaDoGemini('"Internet caindo desde ontem."\n'),
  })

  expect(await escritor.write('minha internet ta caindo')).toBe('Internet caindo desde ontem')
})

// ---------- o cartao ----------

test('o cartao usa o titulo da IA quando ela escreveu um', async () => {
  const escritor = escritorFixo('Internet caindo desde ontem')
  const orq = orquestrador(escritor)

  const r = await orq.handle({
    channel: 'SITE',
    text: 'oi, minha internet ta caindo toda hora desde ontem de manha',
    receivedAt: new Date(),
  })
  if (!r.success) throw new Error('falhou')

  await orq.atualizarTituloDoCartao(r.data.conversationId, 'oi, minha internet ta caindo')

  const [item] = await admin.queue({})
  expect(item?.cardSummary).toBe('Internet caindo desde ontem')

  // E a mensagem crua continua ali, porque a busca do console casa com ela.
  expect(item?.lastMessage).toContain('minha internet ta caindo toda hora')
})

test('sem IA o cartao volta a mostrar a mensagem crua', async () => {
  // Nenhum escritor injetado: e o que acontece quando nao ha chave do Gemini.
  const r = await orquestrador().handle({
    channel: 'SITE',
    text: 'quero cancelar meu plano',
    receivedAt: new Date(),
  })
  if (!r.success) throw new Error('falhou')

  const [item] = await admin.queue({})
  expect(item?.cardSummary).toBeNull()
  expect(item?.lastMessage).toBe('quero cancelar meu plano')
})

test('a conversa do cliente nao muda por causa do titulo', async () => {
  // O ponto do recurso: ele mexe no quadro do atendente, nunca no chat.
  const escritor = escritorFixo('Cancelamento de plano')
  const orq = orquestrador(escritor)

  const r = await orq.handle({
    channel: 'SITE',
    text: 'quero cancelar meu plano',
    receivedAt: new Date(),
  })
  if (!r.success) throw new Error('falhou')

  await orq.atualizarTituloDoCartao(r.data.conversationId, 'quero cancelar meu plano')

  const todas = await mensagens.listByConversation(r.data.conversationId)
  expect(todas.map((m) => m.text)).not.toContain('Cancelamento de plano')
  expect(todas.some((m) => m.text === 'quero cancelar meu plano')).toBe(true)
})

test('o codigo de continuidade nao vira titulo', async () => {
  // E controle, nao pedido: resumi-lo daria um titulo sobre o proprio link.
  const escritor = escritorFixo('Continuacao de atendimento')
  const orq = orquestrador(escritor)

  const c = await conversas.create({ originChannel: 'SITE', currentChannel: 'SITE' })
  await orq.atualizarTituloDoCartao(c.id, 'Continuar atendimento SYNC-ABCDEFGHJKMNPQRS')

  expect(escritor.chamadas).toHaveLength(0)
  expect((await conversas.findById(c.id))?.cardSummary).toBeNull()
})

test('titulo em branco nao sobrescreve o que ja existia', async () => {
  const c = await conversas.create({ originChannel: 'SITE', currentChannel: 'SITE' })
  await conversas.update(c.id, { cardSummary: 'Internet caindo desde ontem' })

  await orquestrador(escritorFixo(null)).atualizarTituloDoCartao(c.id, 'e ai, alguma novidade?')

  expect((await conversas.findById(c.id))?.cardSummary).toBe('Internet caindo desde ontem')
})
