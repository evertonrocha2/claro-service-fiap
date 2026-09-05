import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { PrismaConversationRepository } from '../../context/index.js'
import { criarCliente, limparBase } from '../../testing/fixtures.js'
import { SetContactUseCase } from '../set-contact.use-case.js'

const conversas = new PrismaConversationRepository(prisma)
const caso = new SetContactUseCase(conversas)

beforeEach(limparBase)

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

test('telefone de cliente cadastrado NAO identifica a conversa', async () => {
  const c = await anonima()

  // Telefone nao e segredo. Se informar o numero de alguem promovesse a
  // conversa aquela pessoa, qualquer visitante leria o nome, o servico e o
  // vencimento da fatura dela sem token nenhum. Foi exatamente o que acontecia.
  const r = await caso.execute(c.id, '11987654321')
  expect(r.success).toBe(true)

  expect((await conversas.findById(c.id))?.customerId).toBeNull()
})

test('a resposta nao revela se o numero e de um cliente cadastrado', async () => {
  const c = await anonima()

  const doCliente = await caso.execute(c.id, '11987654321')
  const desconhecido = await caso.execute(c.id, '11900000000')

  if (!doCliente.success || !desconhecido.success) throw new Error('falhou')

  // Respostas com a mesma forma. Diferenciar daria um oraculo para descobrir
  // quais telefones sao clientes da Claro, testando um por um.
  expect(Object.keys(doCliente.data).sort()).toEqual(Object.keys(desconhecido.data).sort())
})

test('telefone invalido e recusado', async () => {
  const c = await anonima()
  const r = await caso.execute(c.id, '123')
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('TELEFONE_INVALIDO')
})

test('a sessao que informou o CPF continua podendo gravar o telefone', async () => {
  // Mesma regra da leitura e do handoff: possuir o id basta. O telefone nao
  // concede identidade nenhuma, entao nao ha o que proteger alem do id.
  const maria = await criarCliente()
  const c = await anonima()
  await conversas.update(c.id, { customerId: maria.id })

  expect((await caso.execute(c.id, '(11) 3456-7890')).success).toBe(true)
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
