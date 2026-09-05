import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import {
  PrismaConversationRepository,
  PrismaCustomerRepository,
  PrismaMessageRepository,
} from '../../context/index.js'
import { criarClienteDoCenario, limparBase } from '../../testing/fixtures.js'
import { ReadConversationUseCase } from '../read-conversation.use-case.js'

const conversas = new PrismaConversationRepository(prisma)
const mensagens = new PrismaMessageRepository(prisma)
const clientes = new PrismaCustomerRepository(prisma)
const caso = new ReadConversationUseCase(conversas, mensagens, clientes)

beforeEach(limparBase)

afterAll(async () => {
  await prisma.$disconnect()
})

async function conversaAnonima() {
  const c = await conversas.create({ originChannel: 'SITE', currentChannel: 'SITE' })
  await mensagens.append({
    conversationId: c.id,
    channel: 'SITE',
    direction: 'INBOUND',
    sender: 'CUSTOMER',
    text: 'minha internet caiu',
  })
  return c
}

test('devolve a conversa anônima com o histórico', async () => {
  const c = await conversaAnonima()
  const r = await caso.execute(c.id)

  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data.protocol).toBe(c.protocol)
  expect(r.data.messages).toHaveLength(1)
  expect(r.data.messages[0]?.text).toBe('minha internet caiu')
})

test('a resposta do atendente aparece para o cliente', async () => {
  const c = await conversaAnonima()
  await mensagens.append({
    conversationId: c.id,
    channel: 'SITE',
    direction: 'OUTBOUND',
    sender: 'AGENT',
    text: 'Oi, sou o Bruno. Vi seu caso aqui.',
  })

  const r = await caso.execute(c.id)
  if (!r.success) throw new Error('falhou')

  expect(r.data.messages.at(-1)?.sender).toBe('AGENT')
  expect(r.data.messages.at(-1)?.text).toBe('Oi, sou o Bruno. Vi seu caso aqui.')
})
test('a sessao anonima nao perde a conversa quando o cliente se identifica', async () => {
  // Caminho previsto no RF002: conversa anonima, cliente informa o CPF no meio e
  // a conversa passa a ter dono. Exigir token do dono aqui apagava o historico
  // da tela de quem estava conversando, no instante seguinte.
  const maria = (await criarClienteDoCenario()).cliente
  const c = await conversaAnonima()

  await conversas.update(c.id, { customerId: maria.id })

  const r = await caso.execute(c.id)
  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data.context.customerName).toBe('Maria Silva')
})

test('possuir o id e o que da acesso, e id inventado nao existe', async () => {
  const c = await conversaAnonima()
  expect((await caso.execute(c.id)).success).toBe(true)
  expect((await caso.execute('id-que-ninguem-tem')).success).toBe(false)
})

test('conversa inexistente devolve erro, não estoura', async () => {
  const r = await caso.execute('nao-existe')
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('CONVERSA_NAO_ENCONTRADA')
})

test('o contexto vem junto, para a barra do site continuar preenchida', async () => {
  const maria = (await criarClienteDoCenario()).cliente
  const c = await conversas.create({
    originChannel: 'SITE',
    currentChannel: 'SITE',
    customerId: maria.id,
  })
  await conversas.update(c.id, { intent: 'PROBLEMA_TECNICO' })

  const r = await caso.execute(c.id)
  if (!r.success) throw new Error('falhou')

  expect(r.data.context.identified).toBe(true)
  expect(r.data.context.customerName).toBe('Maria Silva')
  expect(r.data.context.intent).toBe('PROBLEMA_TECNICO')
})

test('cada mensagem diz de qual canal veio', async () => {
  // O atendente nao troca de ferramenta: ele fica no console do Sync, que ve
  // site e WhatsApp na mesma conversa. Ja as telas do cliente mostram so o que
  // passou por elas, e sem este campo nao havia como recortar.
  //
  // Eu tinha entendido ao contrario e estava levando o historico do site para
  // dentro da janela do WhatsApp, que nao e o que acontece no mundo real.
  const c = await conversas.create({ originChannel: 'SITE', currentChannel: 'SITE' })

  await mensagens.append({
    conversationId: c.id,
    channel: 'SITE',
    direction: 'INBOUND',
    sender: 'CUSTOMER',
    text: 'minha internet caiu',
  })
  await mensagens.append({
    conversationId: c.id,
    channel: 'WHATSAPP',
    direction: 'OUTBOUND',
    sender: 'AGENT',
    text: 'ja estou verificando o sinal por aqui',
  })

  const r = await caso.execute(c.id)
  if (!r.success) throw new Error('falhou')

  // A conversa inteira, que e o que o console recebe.
  expect(r.data.messages.map((m) => m.channel)).toEqual(['SITE', 'WHATSAPP'])

  // O recorte de cada tela do cliente sai deste campo.
  const noZap = r.data.messages.filter((m) => m.channel === 'WHATSAPP')
  expect(noZap).toHaveLength(1)
  expect(noZap[0]?.text).toContain('verificando o sinal')

  const noSite = r.data.messages.filter((m) => m.channel !== 'WHATSAPP')
  expect(noSite).toHaveLength(1)
  expect(noSite[0]?.text).toBe('minha internet caiu')
})
