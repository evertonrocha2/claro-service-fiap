import { prisma } from '@sync/db'
import request from 'supertest'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { createApp } from '../app.js'
import { buildContainer } from '../container.js'

const app = createApp(buildContainer())

const CADASTRO = { cpf: '123.456.789-00', email: 'maria.silva@exemplo.com', password: 'MinhaSenha123' }

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

async function primeiroAcessoELogin() {
  await request(app).post('/api/auth/first-access').send(CADASTRO)
  const r = await request(app)
    .post('/api/auth/login')
    .send({ email: CADASTRO.email, password: CADASTRO.password })
  return r.body as { accessToken: string; refreshToken: string }
}

test('primeiro acesso e login funcionam ponta a ponta', async () => {
  const primeiro = await request(app).post('/api/auth/first-access').send(CADASTRO)
  expect(primeiro.status).toBe(200)

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: CADASTRO.email, password: CADASTRO.password })

  expect(login.status).toBe(200)
  expect(login.body.customer.name).toBe('Maria Silva')
  expect(login.body.accessToken).toBeTruthy()
})

test('senha errada devolve 401, não 400', async () => {
  await request(app).post('/api/auth/first-access').send(CADASTRO)
  const r = await request(app)
    .post('/api/auth/login')
    .send({ email: CADASTRO.email, password: 'ErradaDemais' })

  expect(r.status).toBe(401)
  expect(r.body.error.code).toBe('CREDENCIAIS_INVALIDAS')
})

test('GET /api/auth/me exige token', async () => {
  expect((await request(app).get('/api/auth/me')).status).toBe(401)

  const { accessToken } = await primeiroAcessoELogin()
  const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)
  expect(r.status).toBe(200)
  expect(r.body.kind).toBe('CUSTOMER')
})

test('refresh rotaciona e o token antigo para de valer', async () => {
  const { refreshToken } = await primeiroAcessoELogin()

  const primeira = await request(app).post('/api/auth/refresh').send({ refreshToken })
  expect(primeira.status).toBe(200)
  expect(primeira.body.refreshToken).not.toBe(refreshToken)

  const reuso = await request(app).post('/api/auth/refresh').send({ refreshToken })
  expect(reuso.status).toBe(401)
  expect(reuso.body.error.code).toBe('REFRESH_REUSADO')
})

test('logout encerra a sessão', async () => {
  const { refreshToken } = await primeiroAcessoELogin()
  expect((await request(app).post('/api/auth/logout').send({ refreshToken })).status).toBe(200)
  expect((await request(app).post('/api/auth/refresh').send({ refreshToken })).status).toBe(401)
})

test('RF002: chat autenticado identifica o cliente sem pedir CPF', async () => {
  const { accessToken } = await primeiroAcessoELogin()

  const r = await request(app)
    .post('/api/channels/site/messages')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ text: 'minha internet está caindo' })

  expect(r.status).toBe(200)
  expect(r.body.reply).toContain('Claro Net Fibra 500 Mega')
  expect(r.body.reply.toLowerCase()).not.toContain('informar seu cpf')
})

test('chat sem token continua funcionando de forma anônima', async () => {
  const r = await request(app)
    .post('/api/channels/site/messages')
    .send({ text: 'minha internet está caindo' })

  expect(r.status).toBe(200)
  expect(r.body.reply.toLowerCase()).toContain('cpf')
})

test('customerId no corpo da requisição é ignorado, só o token vale', async () => {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })

  const r = await request(app)
    .post('/api/channels/site/messages')
    .send({ text: 'minha internet está caindo', customerId: maria.id })

  // Sem token, segue anônimo mesmo com o id no corpo.
  expect(r.body.reply.toLowerCase()).toContain('cpf')
})
