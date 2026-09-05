import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { criarCliente, limparBase } from '../../testing/fixtures.js'
import { PrismaConversationRepository } from '../conversation.repository.js'
import { PrismaMessageRepository } from '../message.repository.js'
import { generateProtocol } from '../protocol.js'

const conversas = new PrismaConversationRepository(prisma)
const mensagens = new PrismaMessageRepository(prisma)

beforeEach(limparBase)

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
  const cliente = await criarCliente()

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

test('encontra a conversa pelo protocolo', async () => {
  const c = await conversas.create({ originChannel: 'SITE', currentChannel: 'SITE' })
  const achada = await conversas.findByProtocol(c.protocol)
  expect(achada?.id).toBe(c.id)
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
