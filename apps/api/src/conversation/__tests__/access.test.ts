import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import type { TokenSubject } from '../../auth/tokens.js'
import {
  PrismaConversationRepository,
  PrismaCustomerRepository,
  PrismaMessageRepository,
} from '../../context/index.js'
import { assertPodeAcessar } from '../access.js'
import { HandoffUseCase } from '../handoff.use-case.js'
import { ReadConversationUseCase } from '../read-conversation.use-case.js'
import { SetContactUseCase } from '../set-contact.use-case.js'

const conversas = new PrismaConversationRepository(prisma)
const mensagens = new PrismaMessageRepository(prisma)
const clientes = new PrismaCustomerRepository(prisma)

const ler = new ReadConversationUseCase(conversas, mensagens, clientes)
const contato = new SetContactUseCase(conversas)
const handoff = new HandoffUseCase(prisma, conversas, {
  driver: 'mock',
  mockUrl: 'http://localhost:5175',
})

const cliente = (id: string): TokenSubject => ({ subjectId: id, kind: 'CUSTOMER' })

beforeEach(async () => {
  await prisma.offerInsight.deleteMany()
  await prisma.message.deleteMany()
  await prisma.handoffToken.deleteMany()
  await prisma.conversation.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

// ---------- a regra sozinha ----------

test('cliente logado nao alcanca conversa de outro cliente', () => {
  const r = assertPodeAcessar('maria', cliente('joao'))
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('CONVERSA_DE_OUTRO_CLIENTE')
})

test('o dono alcanca a propria conversa', () => {
  expect(assertPodeAcessar('maria', cliente('maria')).success).toBe(true)
})

test('sessao anonima continua alcancando com o id', () => {
  // Cenario 1 do documento: comeca anonimo, informa o CPF, a conversa ganha
  // dono, e a mesma aba precisa continuar lendo sem nunca ter feito login.
  expect(assertPodeAcessar('maria', undefined).success).toBe(true)
  expect(assertPodeAcessar(null, undefined).success).toBe(true)
})

test('atendente nao e barrado por esta regra', () => {
  // O console tem as proprias regras de papel, em auth/roles.ts.
  expect(assertPodeAcessar('maria', { subjectId: 'bruno', kind: 'AGENT' }).success).toBe(true)
})

// ---------- as tres portas ----------

async function conversaDaMaria() {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const c = await conversas.create({ originChannel: 'SITE', currentChannel: 'SITE' })
  await conversas.update(c.id, { customerId: maria.id })
  return { id: c.id, mariaId: maria.id }
}

test('leitura: outro cliente logado nao le a conversa da Maria', async () => {
  // Antes disto, quem tivesse o id e um login qualquer lia o nome, o servico e o
  // vencimento da fatura de outra pessoa.
  const { id } = await conversaDaMaria()

  const r = await ler.execute(id, cliente('outro-cliente'))
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('CONVERSA_DE_OUTRO_CLIENTE')

  expect((await ler.execute(id, undefined)).success).toBe(true)
})

test('telefone: outro cliente logado nao grava contato na conversa da Maria', async () => {
  const { id } = await conversaDaMaria()

  const r = await contato.execute(id, '11988887777', cliente('outro-cliente'))
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('CONVERSA_DE_OUTRO_CLIENTE')

  const depois = await conversas.findById(id)
  expect(depois?.contactPhone).toBeNull()
})

test('handoff: outro cliente logado nao gera link da conversa da Maria', async () => {
  // O link e uma credencial: gerar um da conversa alheia entregava a conversa.
  const { id } = await conversaDaMaria()

  const r = await handoff.create(id, cliente('outro-cliente'))
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('CONVERSA_DE_OUTRO_CLIENTE')

  expect(await prisma.handoffToken.count({ where: { conversationId: id } })).toBe(0)
})

test('a dona logada faz as tres coisas na conversa dela', async () => {
  const { id, mariaId } = await conversaDaMaria()
  const eu = cliente(mariaId)

  expect((await ler.execute(id, eu)).success).toBe(true)
  expect((await contato.execute(id, '11988887777', eu)).success).toBe(true)
  expect((await handoff.create(id, eu)).success).toBe(true)
})
