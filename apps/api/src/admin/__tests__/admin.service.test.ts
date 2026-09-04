import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { PrismaConversationRepository, PrismaMessageRepository } from '../../context/index.js'
import { AdminService, maskCpf } from '../admin.service.js'

const mensagens = new PrismaMessageRepository(prisma)
const conversas = new PrismaConversationRepository(prisma)
const admin = new AdminService(prisma, mensagens)

async function conversaEsperando(intent: 'CANCELAMENTO' | 'PROBLEMA_TECNICO' = 'CANCELAMENTO') {
  const cliente = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const c = await conversas.create({
    originChannel: 'SITE',
    currentChannel: 'SITE',
    customerId: cliente.id,
  })
  await mensagens.append({
    conversationId: c.id,
    channel: 'SITE',
    direction: 'INBOUND',
    sender: 'CUSTOMER',
    text: 'preciso de ajuda',
  })
  return conversas.update(c.id, { status: 'WAITING_HUMAN', intent })
}

async function atendente() {
  return prisma.agent.upsert({
    where: { email: 'atendente.teste@exemplo.com' },
    update: {},
    create: {
      name: 'Atendente de Teste',
      email: 'atendente.teste@exemplo.com',
      passwordHash: 'irrelevante-aqui',
      role: 'AGENT',
    },
  })
}

beforeEach(async () => {
  await prisma.message.deleteMany()
  await prisma.handoffToken.deleteMany()
  await prisma.conversation.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

test('o CPF nunca aparece inteiro para o atendente', () => {
  expect(maskCpf('12345678900')).toBe('***.456.789-**')
  expect(maskCpf('12345678900')).not.toContain('123')
})

test('a fila traz quem está esperando com o tempo de espera', async () => {
  const c = await conversaEsperando()
  const fila = await admin.queue({}, new Date(c.updatedAt.getTime() + 90_000))

  expect(fila).toHaveLength(1)
  expect(fila[0]?.protocol).toBe(c.protocol)
  expect(fila[0]?.customerName).toBe('Maria Silva')
  expect(fila[0]?.waitingSeconds).toBeGreaterThanOrEqual(89)
  expect(fila[0]?.lastMessage).toBe('preciso de ajuda')
})

test('resolvidos saem da fila', async () => {
  const c = await conversaEsperando()
  await admin.resolve(c.id)
  expect(await admin.queue({})).toHaveLength(0)
})

test('filtra por intenção', async () => {
  await conversaEsperando('CANCELAMENTO')
  await prisma.conversation.deleteMany({ where: { intent: 'PROBLEMA_TECNICO' } })

  expect(await admin.queue({ intent: 'CANCELAMENTO' })).toHaveLength(1)
  expect(await admin.queue({ intent: 'FATURA_SEGUNDA_VIA' })).toHaveLength(0)
})

test('o detalhe traz o histórico e o CPF mascarado', async () => {
  const c = await conversaEsperando()
  const r = await admin.detail(c.id)

  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data.customerCpfMasked).toBe('***.456.789-**')
  expect(r.data.messages).toHaveLength(1)
  expect(r.data.messages[0]?.text).toBe('preciso de ajuda')
})

test('detalhe de atendimento inexistente devolve erro, não estoura', async () => {
  const r = await admin.detail('nao-existe')
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('ATENDIMENTO_NAO_ENCONTRADO')
})

test('assumir muda o status e registra o atendente', async () => {
  const c = await conversaEsperando()
  const bruno = await atendente()

  expect((await admin.claim(c.id, bruno.id)).success).toBe(true)

  const depois = await conversas.findById(c.id)
  expect(depois?.status).toBe('WITH_HUMAN')
  expect(depois?.assignedAgentId).toBe(bruno.id)
})

test('o segundo atendente que clicar no mesmo card perde a corrida', async () => {
  const c = await conversaEsperando()
  const bruno = await atendente()

  expect((await admin.claim(c.id, bruno.id)).success).toBe(true)

  const segunda = await admin.claim(c.id, bruno.id)
  expect(segunda.success).toBe(false)
  if (segunda.success) return
  expect(segunda.error.code).toBe('ATENDIMENTO_JA_ASSUMIDO')
})

test('responder sem ter assumido é recusado', async () => {
  const c = await conversaEsperando()
  const bruno = await atendente()

  const r = await admin.reply(c.id, bruno.id, 'oi')
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('ATENDIMENTO_DE_OUTRO')
})

test('depois de assumir, a resposta entra no histórico como AGENT', async () => {
  const c = await conversaEsperando()
  const bruno = await atendente()
  await admin.claim(c.id, bruno.id)

  expect((await admin.reply(c.id, bruno.id, 'Oi Maria, vi seu caso aqui.')).success).toBe(true)

  const lista = await mensagens.listByConversation(c.id)
  expect(lista.at(-1)?.sender).toBe('AGENT')
  expect(lista.at(-1)?.text).toBe('Oi Maria, vi seu caso aqui.')
})

test('as métricas contam espera, intenção e troca de canal', async () => {
  await conversaEsperando('CANCELAMENTO')

  const cliente = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const trocou = await conversas.create({
    originChannel: 'SITE',
    currentChannel: 'SITE',
    customerId: cliente.id,
  })
  await conversas.update(trocou.id, { currentChannel: 'WHATSAPP', status: 'BOT' })

  const m = await admin.metrics()

  expect(m.waiting).toBe(1)
  expect(m.byIntent).toContainEqual({ intent: 'CANCELAMENTO', waiting: 1 })
  expect(m.channelHandoffs).toBe(1)
})

test('taxa de resolução automática conta só quem nunca passou por humano', async () => {
  const semHumano = await conversaEsperando()
  await admin.resolve(semHumano.id)

  const comHumano = await conversaEsperando()
  const bruno = await atendente()
  await admin.claim(comHumano.id, bruno.id)
  await admin.resolve(comHumano.id)

  const m = await admin.metrics()
  expect(m.botResolutionRate).toBeCloseTo(0.5)
})

test('o quadro mostra também as conversas que ainda estão com a IA', async () => {
  const cliente = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const c = await conversas.create({
    originChannel: 'SITE',
    currentChannel: 'SITE',
    customerId: cliente.id,
  })

  // Este teste dizia o contrário, e travava a regra errada.
  //
  // O quadro era só a fila humana, com o argumento de que conversa com a
  // assistente não espera ninguém. Verdade, mas isso tornava impossível a regra
  // do produto: o atendente pode assumir quando quiser, e a partir daí a IA para
  // de responder. Não dá para assumir o que não aparece em lugar nenhum.
  const fila = await admin.queue({})
  expect(fila.map((i) => i.id)).toContain(c.id)
  expect(fila.find((i) => i.id === c.id)?.status).toBe('BOT')

  // A faixa de indicadores continua separando as duas coisas: ninguém está
  // esperando uma pessoa nesta conversa.
  const m = await admin.metrics()
  expect(m.withBot).toBe(1)
  expect(m.waiting).toBe(0)
})

test('o filtro de situação separa a fila humana da conversa com a IA', async () => {
  const cliente = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  await conversas.create({ originChannel: 'SITE', currentChannel: 'SITE', customerId: cliente.id })
  await conversaEsperando()

  expect(await admin.queue({ status: 'BOT' })).toHaveLength(1)
  expect(await admin.queue({ status: 'WAITING_HUMAN' })).toHaveLength(1)
  expect(await admin.queue({})).toHaveLength(2)
})

test('o card mostra o que o cliente disse, não a última fala do bot', async () => {
  const c = await conversaEsperando()
  await mensagens.append({
    conversationId: c.id,
    channel: 'SITE',
    direction: 'OUTBOUND',
    sender: 'BOT',
    text: 'Vou te transferir para um atendente.',
  })

  const fila = await admin.queue({})
  expect(fila[0]?.lastMessage).toBe('preciso de ajuda')
})

test('o detalhe diz de quem é o atendimento, para a interface não mentir', async () => {
  const c = await conversaEsperando()
  const bruno = await atendente()
  await admin.claim(c.id, bruno.id)

  const r = await admin.detail(c.id)
  expect(r.success && r.data.assignedAgentId).toBe(bruno.id)
})
