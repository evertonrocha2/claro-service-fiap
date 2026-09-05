import type { Channel, InboundMessage } from '@sync/contracts'
import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import {
  PrismaConversationRepository,
  PrismaCustomerRepository,
  PrismaMessageRepository,
} from '../../context/index.js'
import { ConversationOrchestrator } from '../../conversation/orchestrator.js'
import { IdentityService } from '../../identity/identity.service.js'
import { RuleClassifier } from '../../nlp/rule-classifier.js'
import { criarAtendente, limparBase } from '../../testing/fixtures.js'
import { AdminService } from '../admin.service.js'

/**
 * Regra: assumido pelo atendente, a IA para de responder. Nos dois canais.
 *
 * O orquestrador ja se calava em WITH_HUMAN, mas a regra nao tinha como ser
 * acionada: o `claim` recusava conversa em BOT com "outro atendente assumiu
 * este atendimento", que alem de negar mentia sobre o motivo, e o console nem
 * listava essas conversas. O atendente so conseguia entrar depois que a propria
 * IA decidia escalar.
 */

const mensagens = new PrismaMessageRepository(prisma)
const conversas = new PrismaConversationRepository(prisma)
const clientes = new PrismaCustomerRepository(prisma)

const admin = new AdminService(prisma, mensagens)

const orquestrador = new ConversationOrchestrator(
  new IdentityService(clientes, conversas),
  conversas,
  mensagens,
  clientes,
  new RuleClassifier(),
)

function entrada(text: string, channel: Channel, conversationId?: string): InboundMessage {
  return {
    channel,
    text,
    receivedAt: new Date(),
    ...(conversationId ? { conversationId } : {}),
    ...(channel === 'WHATSAPP' ? { phone: '+5511955550042' } : {}),
  }
}

async function atendente() {
  return criarAtendente({ name: 'Bruno Granado', role: 'AGENT' })
}

beforeEach(limparBase)

afterAll(async () => {
  await prisma.$disconnect()
})

// ---------- a porta que faltava ----------

test('o atendente assume uma conversa que ainda esta com a assistente', async () => {
  const bruno = await atendente()

  const primeira = await orquestrador.handle(
    entrada('minha internet esta caindo toda hora', 'SITE'),
  )
  if (!primeira.success) throw new Error('falhou')

  // A IA esta conduzindo, ninguem pediu atendente.
  expect(primeira.data.status).toBe('BOT')
  expect(primeira.data.reply).not.toBeNull()

  const r = await admin.claim(primeira.data.conversationId, bruno.id)
  expect(r.success).toBe(true)

  const depois = await conversas.findById(primeira.data.conversationId)
  expect(depois?.status).toBe('WITH_HUMAN')
  expect(depois?.assignedAgentId).toBe(bruno.id)
})

test('a conversa da assistente aparece no quadro', async () => {
  // Nao da para assumir o que nao se ve. O quadro so listava a fila humana.
  const primeira = await orquestrador.handle(
    entrada('minha internet esta caindo toda hora', 'SITE'),
  )
  if (!primeira.success) throw new Error('falhou')

  const fila = await admin.queue({})
  const alvo = fila.find((i) => i.id === primeira.data.conversationId)

  expect(alvo).toBeDefined()
  expect(alvo?.status).toBe('BOT')
})

// ---------- o silencio, nos dois canais ----------

for (const canal of ['SITE', 'WHATSAPP'] as const) {
  test(`${canal}: assumido o atendimento, a IA nao responde mais`, async () => {
    const bruno = await atendente()

    const primeira = await orquestrador.handle(
      entrada('minha internet esta caindo toda hora', canal),
    )
    if (!primeira.success) throw new Error('falhou')
    const id = primeira.data.conversationId

    expect((await admin.claim(id, bruno.id)).success).toBe(true)

    const segunda = await orquestrador.handle(entrada('e ai, alguma novidade?', canal, id))
    if (!segunda.success) throw new Error('falhou')

    expect(segunda.data.reply).toBeNull()
    expect(segunda.data.status).toBe('WITH_HUMAN')

    // A mensagem do cliente continua sendo registrada: calar a IA nao pode
    // significar perder o que a pessoa escreveu.
    const todas = await mensagens.listByConversation(id)
    expect(todas.some((m) => m.text === 'e ai, alguma novidade?')).toBe(true)

    // E nenhuma fala de bot depois do momento em que o atendente assumiu, tirando
    // o aviso de entrada, que e a unica coisa que o Sync escreve ali.
    const doBot = todas.filter((m) => m.sender === 'BOT')
    expect(doBot.at(-1)?.text).toContain('entrou na conversa')
  })

  test(`${canal}: nem uma mensagem que a IA classificaria como escalada`, async () => {
    // Frases que antes disparavam resposta automatica continuam mudas.
    const bruno = await atendente()

    const primeira = await orquestrador.handle(
      entrada('minha internet esta caindo toda hora', canal),
    )
    if (!primeira.success) throw new Error('falhou')
    const id = primeira.data.conversationId
    await admin.claim(id, bruno.id)

    for (const frase of [
      'quero a segunda via da fatura',
      'quero cancelar meu plano',
      'asdkjhasd',
    ]) {
      const r = await orquestrador.handle(entrada(frase, canal, id))
      if (!r.success) throw new Error('falhou')
      expect(r.data.reply).toBeNull()
    }
  })
}

// ---------- o aviso de entrada ----------

test('o cliente e avisado quando o atendente entra no meio da conversa com a IA', async () => {
  // Sem isto a assistente simplesmente emudece e a pessoa fica falando sozinha.
  const bruno = await atendente()

  const primeira = await orquestrador.handle(
    entrada('minha internet esta caindo toda hora', 'SITE'),
  )
  if (!primeira.success) throw new Error('falhou')

  await admin.claim(primeira.data.conversationId, bruno.id)

  const todas = await mensagens.listByConversation(primeira.data.conversationId)
  expect(todas.at(-1)?.text).toContain('Bruno')
  expect(todas.at(-1)?.text).toContain('entrou na conversa')
})

test('nao repete o aviso quando a propria IA ja anunciou a transferencia', async () => {
  // Em WAITING_HUMAN o bot ja disse "vou transferir voce". Um segundo aviso ali
  // seria a mesma informacao duas vezes.
  const bruno = await atendente()

  const primeira = await orquestrador.handle(entrada('quero falar com um atendente', 'SITE'))
  if (!primeira.success) throw new Error('falhou')
  expect(primeira.data.status).toBe('WAITING_HUMAN')

  const antes = (await mensagens.listByConversation(primeira.data.conversationId)).length
  await admin.claim(primeira.data.conversationId, bruno.id)
  const depois = (await mensagens.listByConversation(primeira.data.conversationId)).length

  expect(depois).toBe(antes)
})

// ---------- recusas honestas ----------

test('dois atendentes nao assumem a mesma conversa', async () => {
  const bruno = await atendente()
  const outro = await criarAtendente({ name: 'Outra Pessoa', role: 'AGENT' })

  const primeira = await orquestrador.handle(
    entrada('minha internet esta caindo toda hora', 'SITE'),
  )
  if (!primeira.success) throw new Error('falhou')

  expect((await admin.claim(primeira.data.conversationId, bruno.id)).success).toBe(true)

  const segunda = await admin.claim(primeira.data.conversationId, outro.id)
  expect(segunda.success).toBe(false)
  if (segunda.success) return
  expect(segunda.error.code).toBe('ATENDIMENTO_JA_ASSUMIDO')
})

test('atendimento encerrado diz que foi encerrado, e nao que outro assumiu', async () => {
  // O erro antigo era um so para tudo, e mentia: dizia "outro atendente assumiu"
  // quando o motivo era o status.
  const bruno = await atendente()

  const primeira = await orquestrador.handle(
    entrada('minha internet esta caindo toda hora', 'SITE'),
  )
  if (!primeira.success) throw new Error('falhou')

  await conversas.update(primeira.data.conversationId, { status: 'RESOLVED' })

  const r = await admin.claim(primeira.data.conversationId, bruno.id)
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('ATENDIMENTO_ENCERRADO')
})
