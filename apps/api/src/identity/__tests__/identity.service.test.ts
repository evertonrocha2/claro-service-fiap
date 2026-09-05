import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { PrismaConversationRepository } from '../../context/conversation.repository.js'
import { PrismaCustomerRepository } from '../../context/customer.repository.js'
import { criarClienteDoCenario, limparBase } from '../../testing/fixtures.js'
import { IdentityService } from '../identity.service.js'

const conversas = new PrismaConversationRepository(prisma)
const servico = new IdentityService(new PrismaCustomerRepository(prisma), conversas)

beforeEach(async () => {
  await limparBase()
  await criarClienteDoCenario()
})

afterAll(async () => {
  await prisma.$disconnect()
})

test('resolve por customerId', async () => {
  const esperado = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  expect((await servico.identify({ customerId: esperado.id }))?.id).toBe(esperado.id)
})

test('resolve por telefone', async () => {
  expect((await servico.identify({ phone: '+5511987654321' }))?.cpf).toBe('12345678900')
})

test('resolve por CPF', async () => {
  expect((await servico.identify({ cpf: '12345678900' }))?.name).toBe('Maria Silva')
})

test('resolve por protocolo de conversa anterior', async () => {
  const cliente = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const conversa = await conversas.create({
    originChannel: 'SITE',
    currentChannel: 'SITE',
    customerId: cliente.id,
  })
  expect((await servico.identify({ protocol: conversa.protocol }))?.id).toBe(cliente.id)
})

test('customerId tem prioridade sobre CPF conflitante', async () => {
  const maria = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  const achado = await servico.identify({ customerId: maria.id, cpf: '98765432100' })
  expect(achado?.id).toBe(maria.id)
})

test('devolve null quando nada resolve', async () => {
  expect(await servico.identify({ cpf: '00000000000' })).toBeNull()
  expect(await servico.identify({})).toBeNull()
})
