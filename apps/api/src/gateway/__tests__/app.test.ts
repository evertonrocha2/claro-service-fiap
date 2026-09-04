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
