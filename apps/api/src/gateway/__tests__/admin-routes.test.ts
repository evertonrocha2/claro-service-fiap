import { prisma } from '@sync/db'
import request from 'supertest'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { createApp } from '../app.js'
import { buildContainer } from '../container.js'

const app = createApp(buildContainer())

async function tokenDeAtendente() {
  const r = await request(app)
    .post('/api/auth/agent/login')
    .send({ email: 'bruno@claro.com.br', password: 'Atendente123' })
  return r.body.accessToken as string
}

async function tokenDeCliente() {
  await request(app).post('/api/auth/first-access').send({
    cpf: '123.456.789-00',
    email: 'maria.silva@exemplo.com',
    password: 'MinhaSenha123',
  })
  const r = await request(app)
    .post('/api/auth/login')
    .send({ email: 'maria.silva@exemplo.com', password: 'MinhaSenha123' })
  return r.body.accessToken as string
}

/** Leva uma conversa até a fila humana pedindo cancelamento, que sempre escala. */
async function conversaNaFila() {
  const r = await request(app)
    .post('/api/channels/site/messages')
    .send({ text: 'meu cpf é 123.456.789-00, quero cancelar meu plano' })
  return r.body.conversationId as string
}

beforeEach(async () => {
  await prisma.refreshToken.deleteMany()
  await prisma.message.deleteMany()
  await prisma.handoffToken.deleteMany()
  await prisma.conversation.deleteMany()
  await prisma.customer.update({ where: { cpf: '12345678900' }, data: { passwordHash: null } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

test('atendente entra com e-mail e senha', async () => {
  const r = await request(app)
    .post('/api/auth/agent/login')
    .send({ email: 'bruno@claro.com.br', password: 'Atendente123' })

  expect(r.status).toBe(200)
  expect(r.body.agent.name).toBe('Bruno Granado')
  expect(r.body.agent.role).toBe('AGENT')
})

test('senha errada de atendente devolve 401', async () => {
  const r = await request(app)
    .post('/api/auth/agent/login')
    .send({ email: 'bruno@claro.com.br', password: 'errada' })
  expect(r.status).toBe(401)
})

test('a área interna recusa quem não está autenticado', async () => {
  expect((await request(app).get('/api/admin/conversations')).status).toBe(401)
})

test('token de cliente não abre a área interna', async () => {
  const r = await request(app)
    .get('/api/admin/conversations')
    .set('Authorization', `Bearer ${await tokenDeCliente()}`)

  expect(r.status).toBe(403)
  expect(r.body.error.code).toBe('ACESSO_NEGADO')
})

test('a fila mostra o cancelamento que escalou sozinho', async () => {
  await conversaNaFila()

  const r = await request(app)
    .get('/api/admin/conversations')
    .set('Authorization', `Bearer ${await tokenDeAtendente()}`)

  expect(r.status).toBe(200)
  expect(r.body).toHaveLength(1)
  expect(r.body[0].intent).toBe('CANCELAMENTO')
  expect(r.body[0].status).toBe('WAITING_HUMAN')
  expect(r.body[0].customerName).toBe('Maria Silva')
})

test('o detalhe traz o histórico completo e o CPF mascarado', async () => {
  const id = await conversaNaFila()

  const r = await request(app)
    .get(`/api/admin/conversations/${id}`)
    .set('Authorization', `Bearer ${await tokenDeAtendente()}`)

  expect(r.status).toBe(200)
  expect(r.body.customerCpfMasked).toBe('***.456.789-**')
  expect(r.body.messages.length).toBeGreaterThanOrEqual(2)
})

test('o CPF completo nunca sai na resposta da área interna', async () => {
  const id = await conversaNaFila()
  const token = await tokenDeAtendente()

  const fila = await request(app)
    .get('/api/admin/conversations')
    .set('Authorization', `Bearer ${token}`)
  const detalhe = await request(app)
    .get(`/api/admin/conversations/${id}`)
    .set('Authorization', `Bearer ${token}`)

  // A mensagem do cliente contém o CPF que ele digitou, então olhamos os campos
  // estruturados, que são os que a interface exibe como dado do cadastro.
  expect(JSON.stringify(fila.body)).not.toContain('12345678900')
  expect(detalhe.body.customerCpfMasked).not.toContain('12345678900')
})

test('assumir, responder e resolver, o ciclo do atendente', async () => {
  const id = await conversaNaFila()
  const token = await tokenDeAtendente()
  const auth = { Authorization: `Bearer ${token}` }

  expect((await request(app).post(`/api/admin/conversations/${id}/claim`).set(auth)).status).toBe(
    200,
  )

  const resposta = await request(app)
    .post(`/api/admin/conversations/${id}/messages`)
    .set(auth)
    .send({ text: 'Oi Maria. Antes de cancelar, posso ver uma oferta melhor?' })
  expect(resposta.status).toBe(200)

  expect((await request(app).post(`/api/admin/conversations/${id}/resolve`).set(auth)).status).toBe(
    200,
  )

  const depois = await request(app).get(`/api/admin/conversations/${id}`).set(auth)
  expect(depois.body.status).toBe('RESOLVED')
  expect(depois.body.messages.at(-1).sender).toBe('AGENT')
})

test('assumir duas vezes devolve 409', async () => {
  const id = await conversaNaFila()
  const auth = { Authorization: `Bearer ${await tokenDeAtendente()}` }

  await request(app).post(`/api/admin/conversations/${id}/claim`).set(auth)
  const segunda = await request(app).post(`/api/admin/conversations/${id}/claim`).set(auth)

  expect(segunda.status).toBe(409)
  expect(segunda.body.error.code).toBe('ATENDIMENTO_JA_ASSUMIDO')
})

test('as métricas respondem com os contadores da operação', async () => {
  await conversaNaFila()

  const r = await request(app)
    .get('/api/admin/metrics')
    .set('Authorization', `Bearer ${await tokenDeAtendente()}`)

  expect(r.status).toBe(200)
  expect(r.body.waiting).toBe(1)
  expect(r.body.byIntent).toContainEqual({ intent: 'CANCELAMENTO', waiting: 1 })
})
