import { prisma } from '@sync/db'
import request from 'supertest'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { createApp } from '../app.js'
import { buildContainer } from '../container.js'

const app = createApp(buildContainer())

const CADASTRO = {
  cpf: '123.456.789-00',
  email: 'maria.silva@exemplo.com',
  password: 'MinhaSenha123',
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

test('o cliente lê a própria conversa e vê a resposta do atendente', async () => {
  const inicio = await request(app)
    .post('/api/channels/site/messages')
    .send({ text: 'quero cancelar meu plano' })
  const id = inicio.body.conversationId as string

  const agente = await request(app)
    .post('/api/auth/agent/login')
    .send({ email: 'bruno@claro.com.br', password: 'Atendente123' })
  const auth = { Authorization: `Bearer ${agente.body.accessToken}` }

  await request(app).post(`/api/admin/conversations/${id}/claim`).set(auth)
  await request(app)
    .post(`/api/admin/conversations/${id}/messages`)
    .set(auth)
    .send({ text: 'Aqui é o Bruno. Já vi seu pedido.' })

  const lida = await request(app).get(`/api/conversations/${id}`)
  expect(lida.status).toBe(200)
  expect(lida.body.protocol).toBe(inicio.body.protocol)
  expect(lida.body.messages.at(-1).sender).toBe('AGENT')
  expect(lida.body.messages.at(-1).text).toBe('Aqui é o Bruno. Já vi seu pedido.')
})

test('conversa de outro cliente devolve 403', async () => {
  const { accessToken: token } = await primeiroAcessoELogin()
  const minha = await request(app)
    .post('/api/channels/site/messages')
    .set('Authorization', `Bearer ${token}`)
    .send({ text: 'quero cancelar meu plano' })

  // Sem token, a conversa já tem dono e não pode ser lida.
  const semToken = await request(app).get(`/api/conversations/${minha.body.conversationId}`)
  expect(semToken.status).toBe(403)

  const comToken = await request(app)
    .get(`/api/conversations/${minha.body.conversationId}`)
    .set('Authorization', `Bearer ${token}`)
  expect(comToken.status).toBe(200)
})

test('conversa inexistente devolve 404', async () => {
  expect((await request(app).get('/api/conversations/nao-existe')).status).toBe(404)
})

test('informar o telefone de outra pessoa nao da acesso aos dados dela', async () => {
  // Reproduz a falha encontrada pela revisao de seguranca. Telefone nao e
  // segredo: sabendo so o numero da Maria, um anonimo obtinha o nome dela, o
  // servico contratado e o vencimento da fatura, sem token nenhum.
  const inicio = await request(app).post('/api/channels/site/messages').send({ text: 'oi' })
  const id = inicio.body.conversationId as string

  const contato = await request(app)
    .post(`/api/conversations/${id}/contact`)
    .send({ phone: '11987654321' })
  expect(contato.status).toBe(200)

  // A rota nao diz se aquele numero pertence a um cliente cadastrado.
  expect(contato.body).not.toHaveProperty('identified')

  const depois = await request(app)
    .post('/api/channels/site/messages')
    .send({ text: 'quero a segunda via da fatura', conversationId: id })

  expect(depois.body.context.identified).toBe(false)
  expect(depois.body.context.customerName).toBeNull()
  expect(depois.body.context.serviceLabel).toBeNull()
  expect(depois.body.reply).not.toContain('20/05')
  expect(depois.body.reply).not.toContain('Maria')
  expect(depois.body.reply).not.toContain('Claro Net Fibra')
})

test('o telefone gravado ainda serve para reencontrar a conversa', async () => {
  // A correcao nao pode ter matado a continuidade entre canais. Numero sem dono
  // cadastrado continua ligando os dois lados, que e o caso de uso legitimo.
  const inicio = await request(app).post('/api/channels/site/messages').send({ text: 'oi' })
  const id = inicio.body.conversationId as string

  await request(app).post(`/api/conversations/${id}/contact`).send({ phone: '11900001111' })

  const conversa = await prisma.conversation.findUniqueOrThrow({ where: { id } })
  expect(conversa.contactPhone).toBe('+5511900001111')
  expect(conversa.customerId).toBeNull()
})
