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
  expect(r.data.reply).not.toBeNull()
  expect(r.data.reply?.toLowerCase()).toContain('cpf')
  expect(r.data.protocol).toHaveLength(13)
})

test('cliente autenticado recebe resposta contextualizada sem pedir CPF', async () => {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const r = await orquestrador.handle(
    entrada('minha internet está caindo', { customerId: maria.id }),
  )
  expect(r.success).toBe(true)
  if (!r.success) return

  expect(r.data.reply ?? '').toContain('Claro Net Fibra 500 Mega')
  expect(r.data.reply?.toLowerCase()).not.toContain('informar seu cpf')
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
  expect(r.data.reply?.toLowerCase()).toContain('histórico')

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
  expect(r.data.reply ?? '').toContain('Plano móvel final 9876')
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

test('RF005: o cliente identificado numa mensagem não é perguntado de novo na seguinte', async () => {
  // Cenário real: cliente anônimo informa o CPF, e na mensagem seguinte pede a
  // fatura sem repetir nada. O contexto tem que vir da conversa, não da mensagem.
  const primeira = await orquestrador.handle(entrada('meu cpf é 123.456.789-00'))
  if (!primeira.success) throw new Error('falhou')

  const conversa = await conversas.findById(primeira.data.conversationId)
  expect(conversa?.customerId).not.toBeNull()

  const segunda = await orquestrador.handle(
    entrada('quero a segunda via da fatura', { conversationId: primeira.data.conversationId }),
  )
  if (!segunda.success) throw new Error('falhou')

  expect(segunda.data.reply ?? '').toContain('20/05')
  expect(segunda.data.reply?.toLowerCase()).not.toContain('informar seu cpf')
})

test('a resposta carrega o contexto conhecido, para a interface mostrar', async () => {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const r = await orquestrador.handle(
    entrada('minha internet está caindo', { customerId: maria.id }),
  )
  if (!r.success) throw new Error('falhou')

  expect(r.data.context).toEqual({
    identified: true,
    customerName: 'Maria Silva',
    channel: 'SITE',
    originChannel: 'SITE',
    intent: 'PROBLEMA_TECNICO',
    serviceLabel: 'Claro Net Fibra 500 Mega',
  })
})

test('o contexto de quem não foi identificado vem vazio, não inventado', async () => {
  const r = await orquestrador.handle(entrada('bom dia'))
  if (!r.success) throw new Error('falhou')

  expect(r.data.context.identified).toBe(false)
  expect(r.data.context.customerName).toBeNull()
  expect(r.data.context.serviceLabel).toBeNull()
  expect(r.data.context.intent).toBeNull()
})

test('RF005 entre canais: mensagem do WhatsApp retoma o atendimento do site', async () => {
  // Cliente anonimo conversa no site e informa o telefone.
  const noSite = await orquestrador.handle(entrada('minha internet esta caindo'))
  if (!noSite.success) throw new Error('falhou')

  await conversas.update(noSite.data.conversationId, { contactPhone: '+551134567890' })

  // Dias depois escreve do WhatsApp. O webhook da Meta entrega o telefone, que
  // e a unica chave que os dois canais dividem quando nao houve login.
  const noZap = await orquestrador.handle({
    channel: 'WHATSAPP',
    text: 'oi, e sobre aquela internet',
    receivedAt: new Date(),
    phone: '+551134567890',
  })
  if (!noZap.success) throw new Error('falhou')

  expect(noZap.data.conversationId).toBe(noSite.data.conversationId)
  expect(noZap.data.protocol).toBe(noSite.data.protocol)
  expect(noZap.data.context.originChannel).toBe('SITE')
  expect(noZap.data.context.channel).toBe('WHATSAPP')

  // O historico inteiro continua num lugar so, que e o ponto do produto.
  const lista = await mensagens.listByConversation(noSite.data.conversationId)
  expect(lista.length).toBe(4)
  expect(lista[0]?.channel).toBe('SITE')
  expect(lista.at(-1)?.channel).toBe('WHATSAPP')
})

test('telefone desconhecido no WhatsApp abre atendimento novo', async () => {
  await orquestrador.handle(entrada('minha internet esta caindo'))

  const noZap = await orquestrador.handle({
    channel: 'WHATSAPP',
    text: 'oi',
    receivedAt: new Date(),
    phone: '+5511900000000',
  })
  if (!noZap.success) throw new Error('falhou')

  expect(noZap.data.context.originChannel).toBe('WHATSAPP')
})

test('o telefone da primeira mensagem do WhatsApp fica gravado na conversa', async () => {
  const r = await orquestrador.handle({
    channel: 'WHATSAPP',
    text: 'quero a segunda via da fatura',
    receivedAt: new Date(),
    phone: '+5511977776666',
  })
  if (!r.success) throw new Error('falhou')

  expect((await conversas.findById(r.data.conversationId))?.contactPhone).toBe('+5511977776666')
})

test('depois de escalar, o bot para de responder', async () => {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })

  const escalou = await orquestrador.handle(
    entrada('quero cancelar meu plano', { customerId: maria.id }),
  )
  if (!escalou.success) throw new Error('falhou')
  expect(escalou.data.status).toBe('WAITING_HUMAN')
  expect(escalou.data.reply).not.toBeNull()

  // Cliente continua escrevendo enquanto espera. O Sync registra e cala.
  const depois = await orquestrador.handle(entrada('alo, tem alguem ai?', { customerId: maria.id }))
  if (!depois.success) throw new Error('falhou')

  expect(depois.data.reply).toBeNull()
  expect(depois.data.status).toBe('WAITING_HUMAN')
})

test('com o atendente na conversa o bot nao escreve nem uma vez', async () => {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const bruno = await prisma.agent.findFirstOrThrow({ where: { email: 'bruno@claro.com.br' } })

  const escalou = await orquestrador.handle(
    entrada('quero falar com um atendente', { customerId: maria.id }),
  )
  if (!escalou.success) throw new Error('falhou')

  await conversas.update(escalou.data.conversationId, {
    status: 'WITH_HUMAN',
    claimedAt: new Date(),
  })
  await prisma.conversation.update({
    where: { id: escalou.data.conversationId },
    data: { assignedAgentId: bruno.id },
  })

  // Atendente pergunta o nome, cliente responde. Era exatamente aqui que o bot
  // emendava "vou passar para um atendente" com um atendente ja falando.
  await mensagens.append({
    conversationId: escalou.data.conversationId,
    channel: 'SITE',
    direction: 'OUTBOUND',
    sender: 'AGENT',
    text: 'Olá, pode me informar seu nome?',
  })

  const resposta = await orquestrador.handle(
    entrada('Everton Silva, meu problema e com a internet', { customerId: maria.id }),
  )
  if (!resposta.success) throw new Error('falhou')

  expect(resposta.data.reply).toBeNull()

  const lista = await mensagens.listByConversation(escalou.data.conversationId)
  expect(lista.filter((m) => m.sender === 'BOT')).toHaveLength(1)
  expect(lista.at(-1)?.sender).toBe('CUSTOMER')
})

test('a mensagem do cliente continua registrada para o atendente ver', async () => {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })

  const escalou = await orquestrador.handle(
    entrada('quero cancelar meu plano', { customerId: maria.id }),
  )
  if (!escalou.success) throw new Error('falhou')

  await orquestrador.handle(entrada('e urgente, por favor', { customerId: maria.id }))

  const lista = await mensagens.listByConversation(escalou.data.conversationId)
  expect(lista.at(-1)?.text).toBe('e urgente, por favor')
  expect(lista.at(-1)?.sender).toBe('CUSTOMER')
})

test('o assunto nao muda depois de escalar', async () => {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })

  const escalou = await orquestrador.handle(
    entrada('quero cancelar meu plano', { customerId: maria.id }),
  )
  if (!escalou.success) throw new Error('falhou')

  // "obrigado" classificaria como DESCONHECIDA. Se sobrescrevesse, o card do
  // atendente trocaria de assunto no meio do atendimento.
  const depois = await orquestrador.handle(entrada('obrigado', { customerId: maria.id }))
  if (!depois.success) throw new Error('falhou')

  expect(depois.data.intent).toBe('CANCELAMENTO')
  expect((await conversas.findById(escalou.data.conversationId))?.intent).toBe('CANCELAMENTO')
})
