import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { PrismaConversationRepository, PrismaCustomerRepository } from '../../context/index.js'
import { SetContactUseCase } from '../set-contact.use-case.js'

const conversas = new PrismaConversationRepository(prisma)
const caso = new SetContactUseCase(conversas, new PrismaCustomerRepository(prisma))

beforeEach(async () => {
  await prisma.offerInsight.deleteMany()
  await prisma.message.deleteMany()
  await prisma.handoffToken.deleteMany()
  await prisma.conversation.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

const anonima = () => conversas.create({ originChannel: 'SITE', currentChannel: 'SITE' })

test('grava o telefone normalizado na conversa', async () => {
  const c = await anonima()
  const r = await caso.execute(c.id, '(11) 3456-7890')

  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data.phone).toBe('+551134567890')

  expect((await conversas.findById(c.id))?.contactPhone).toBe('+551134567890')
})

test('telefone de cliente cadastrado tambem identifica a conversa', async () => {
  const c = await anonima()
  const r = await caso.execute(c.id, '11987654321')

  expect(r.success && r.data.identified).toBe(true)

  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  expect((await conversas.findById(c.id))?.customerId).toBe(maria.id)
})

test('telefone invalido e recusado', async () => {
  const c = await anonima()
  const r = await caso.execute(c.id, '123')
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('TELEFONE_INVALIDO')
})

test('nao deixa gravar telefone na conversa de outro cliente', async () => {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const c = await conversas.create({
    originChannel: 'SITE',
    currentChannel: 'SITE',
    customerId: maria.id,
  })

  const r = await caso.execute(c.id, '(11) 3456-7890')
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('CONVERSA_DE_OUTRO_CLIENTE')
})

test('RF005 entre canais: o telefone retoma a conversa do site', async () => {
  const doSite = await anonima()
  await caso.execute(doSite.id, '(11) 3456-7890')

  const retomada = await conversas.findOpenByPhone('+551134567890')
  expect(retomada?.id).toBe(doSite.id)
})

test('o mesmo numero escrito de outra forma ainda retoma a conversa', async () => {
  const doSite = await anonima()
  await caso.execute(doSite.id, '(11) 3456-7890')

  // O webhook da Meta entrega em outro formato. Se a chave nao fosse
  // normalizada, o atendimento recomecaria do zero no WhatsApp.
  expect((await conversas.findOpenByPhone('+551134567890'))?.id).toBe(doSite.id)
})

test('conversa resolvida nao e retomada pelo telefone', async () => {
  const c = await anonima()
  await caso.execute(c.id, '(11) 3456-7890')
  await conversas.update(c.id, { status: 'RESOLVED', resolvedAt: new Date() })

  expect(await conversas.findOpenByPhone('+551134567890')).toBeNull()
})
