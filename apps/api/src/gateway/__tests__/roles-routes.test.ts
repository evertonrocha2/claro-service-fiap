import { prisma } from '@sync/db'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { criarAtendente, limparBase } from '../../testing/fixtures.js'
import { createApp } from '../app.js'
import { buildContainer } from '../container.js'

const app = createApp(buildContainer())

const SENHA = 'Atendente123'

type Sessao = { token: string; agentId: string; auth: { Authorization: string } }

/** Bruno é AGENT, Leticia é MANAGER, e os dois nascem no beforeAll abaixo. */
async function entrar(email: string): Promise<Sessao> {
  const r = await request(app).post('/api/auth/agent/login').send({ email, password: SENHA })

  if (!r.body?.agent) {
    throw new Error(`login de ${email} falhou: ${r.status} ${JSON.stringify(r.body)}`)
  }

  return {
    token: r.body.accessToken,
    agentId: r.body.agent.id,
    auth: { Authorization: `Bearer ${r.body.accessToken}` },
  }
}

/**
 * Uma sessão por suíte, não por teste.
 *
 * As rotas de login têm rate limit de dez tentativas por quinze minutos, que é
 * proposital. Autenticar em cada caso estourava o limite no meio da suíte e as
 * falhas apareciam como erro de leitura de propriedade, escondendo a causa.
 */
let bruno: Sessao
let leticia: Sessao

beforeAll(async () => {
  // A equipe deste arquivo e criada aqui: um atendimento, uma gestao e um
  // terceiro que um teste remove para verificar a perda de acesso.
  await limparBase()
  await criarAtendente({ name: 'Bruno Granado', email: 'bruno@claro.com.br', password: SENHA })
  await criarAtendente({
    name: 'Leticia Vitalino',
    email: 'leticia@claro.com.br',
    password: SENHA,
    role: 'MANAGER',
  })
  await criarAtendente({
    name: 'Gustavo Ressurreicao',
    email: 'gustavo@claro.com.br',
    password: SENHA,
  })
  await criarAtendente({ name: 'Isaac Destro', email: 'isaac@claro.com.br', password: SENHA })

  bruno = await entrar('bruno@claro.com.br')
  leticia = await entrar('leticia@claro.com.br')
})

async function conversaNaFila() {
  const r = await request(app)
    .post('/api/channels/site/messages')
    .send({ text: 'meu cpf é 123.456.789-00, quero cancelar meu plano' })
  return r.body.conversationId as string
}

beforeEach(async () => {
  await prisma.offerInsight.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.message.deleteMany()
  await prisma.handoffToken.deleteMany()
  await prisma.conversation.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

// ---------- quem sou eu ----------

test('a rota me devolve o perfil e o que ele pode fazer', async () => {
  const dele = await request(app).get('/api/admin/me').set(bruno.auth)

  expect(dele.status).toBe(200)
  expect(dele.body.role).toBe('AGENT')
  expect(dele.body.canViewTeam).toBe(false)

  const dela = await request(app).get('/api/admin/me').set(leticia.auth)

  expect(dela.body.role).toBe('MANAGER')
  expect(dela.body.canViewTeam).toBe(true)
})

// ---------- desempenho proprio ----------

test('qualquer perfil ve os proprios numeros', async () => {
  const r = await request(app).get('/api/admin/performance/me').set(bruno.auth)

  expect(r.status).toBe(200)
  expect(r.body.agentId).toBe(bruno.agentId)
  expect(r.body.name).toBe('Bruno Granado')
})

test('o tempo medio de atendimento mede do assumir ao encerrar', async () => {
  const id = await conversaNaFila()

  await request(app).post(`/api/admin/conversations/${id}/claim`).set(bruno.auth)
  await request(app).post(`/api/admin/conversations/${id}/resolve`).set(bruno.auth)

  const r = await request(app).get('/api/admin/performance/me').set(bruno.auth)
  expect(r.body.resolvedTotal).toBe(1)
  expect(r.body.resolvedToday).toBe(1)
  expect(r.body.avgHandlingSeconds).not.toBeNull()
  expect(r.body.avgHandlingSeconds).toBeGreaterThanOrEqual(0)
})

test('sem atendimento encerrado o tempo medio fica nulo, nao zero', async () => {
  const r = await request(app).get('/api/admin/performance/me').set(bruno.auth)

  // Zero afirmaria que ele resolve instantaneamente. Nulo diz que nao ha medida.
  expect(r.body.avgHandlingSeconds).toBeNull()
})

// ---------- desempenho da equipe ----------

test('atendente nao ve o desempenho da equipe', async () => {
  const r = await request(app).get('/api/admin/performance/team').set(bruno.auth)

  expect(r.status).toBe(403)
  expect(r.body.error.code).toBe('PERMISSAO_INSUFICIENTE')
})

test('gestor ve a equipe inteira', async () => {
  const r = await request(app).get('/api/admin/performance/team').set(leticia.auth)

  expect(r.status).toBe(200)
  expect(r.body.length).toBeGreaterThanOrEqual(4)
  expect(r.body.map((a: { name: string }) => a.name)).toContain('Bruno Granado')
})

test('atendente nao le os numeros de outro atendente', async () => {
  const r = await request(app).get(`/api/admin/performance/${leticia.agentId}`).set(bruno.auth)

  expect(r.status).toBe(403)
})

test('atendente le os proprios numeros pelo id', async () => {
  const r = await request(app).get(`/api/admin/performance/${bruno.agentId}`).set(bruno.auth)

  expect(r.status).toBe(200)
  expect(r.body.agentId).toBe(bruno.agentId)
})

test('gestor le os numeros de qualquer atendente', async () => {
  const r = await request(app).get(`/api/admin/performance/${bruno.agentId}`).set(leticia.auth)
  expect(r.status).toBe(200)
  expect(r.body.name).toBe('Bruno Granado')
})

// ---------- fila filtrada por responsavel ----------

test('assignedTo=me traz so os meus atendimentos', async () => {
  const id = await conversaNaFila()
  await request(app).post(`/api/admin/conversations/${id}/claim`).set(bruno.auth)

  const meus = await request(app)
    .get('/api/admin/conversations?assignedTo=me&status=WITH_HUMAN')
    .set(bruno.auth)

  expect(meus.status).toBe(200)
  expect(meus.body).toHaveLength(1)
  expect(meus.body[0].id).toBe(id)
})

test('a fila de outro atendente nao abre trocando o parametro na URL', async () => {
  const r = await request(app)
    .get(`/api/admin/conversations?assignedTo=${leticia.agentId}`)
    .set(bruno.auth)

  expect(r.status).toBe(403)
  expect(r.body.error.code).toBe('PERMISSAO_INSUFICIENTE')
})

test('gestor filtra pela fila de qualquer atendente', async () => {
  const id = await conversaNaFila()
  await request(app).post(`/api/admin/conversations/${id}/claim`).set(bruno.auth)

  const r = await request(app)
    .get(`/api/admin/conversations?assignedTo=${bruno.agentId}&status=WITH_HUMAN`)
    .set(leticia.auth)

  expect(r.status).toBe(200)
  expect(r.body).toHaveLength(1)
})

// ---------- o papel vem do banco, nao do token ----------

test('rebaixar um gestor vale na hora, sem esperar o token expirar', async () => {
  expect((await request(app).get('/api/admin/performance/team').set(leticia.auth)).status).toBe(200)

  // Mesmo token, papel novo. Se o papel viesse do JWT, ela continuaria gestora
  // por ate quinze minutos depois da mudanca.
  await prisma.agent.update({
    where: { email: 'leticia@claro.com.br' },
    data: { role: 'AGENT' },
  })

  const depois = await request(app).get('/api/admin/performance/team').set(leticia.auth)
  expect(depois.status).toBe(403)

  await prisma.agent.update({
    where: { email: 'leticia@claro.com.br' },
    data: { role: 'MANAGER' },
  })
})

test('conta removida perde o acesso imediatamente', async () => {
  const gustavo = await entrar('gustavo@claro.com.br')
  expect((await request(app).get('/api/admin/me').set(gustavo.auth)).status).toBe(200)

  await prisma.agent.delete({ where: { email: 'gustavo@claro.com.br' } })

  const depois = await request(app).get('/api/admin/conversations').set(gustavo.auth)
  expect(depois.status).toBe(403)
  expect(depois.body.error.code).toBe('ACESSO_NEGADO')

  await prisma.agent.create({
    data: {
      name: 'Gustavo Ressurreicao',
      email: 'gustavo@claro.com.br',
      passwordHash: (
        await prisma.agent.findFirstOrThrow({ where: { email: 'bruno@claro.com.br' } })
      ).passwordHash,
      role: 'AGENT',
    },
  })
})
