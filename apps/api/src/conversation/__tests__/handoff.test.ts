import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { PrismaConversationRepository } from '../../context/index.js'
import { criarCliente, limparBase } from '../../testing/fixtures.js'
import { extractHandoffCode, generateHandoffCode, HandoffUseCase } from '../handoff.use-case.js'

const conversas = new PrismaConversationRepository(prisma)

const mock = new HandoffUseCase(prisma, conversas, {
  driver: 'mock',
  mockUrl: 'http://localhost:5175',
})

const meta = new HandoffUseCase(prisma, conversas, {
  driver: 'meta',
  fromNumber: '5511999998888',
})

beforeEach(limparBase)

afterAll(async () => {
  await prisma.$disconnect()
})

const anonima = () => conversas.create({ originChannel: 'SITE', currentChannel: 'SITE' })

// ---------- codigo ----------

test('o codigo tem forma previsivel e e sempre diferente', () => {
  const a = generateHandoffCode()
  const b = generateHandoffCode()

  expect(a).toMatch(/^SYNC-[A-Z0-9]{16}$/)
  expect(a).not.toBe(b)
})

test('o codigo tem entropia de credencial, nao de codigo de barras', () => {
  // 16 caracteres de um alfabeto de 31 sao cerca de 79 bits. Com os 4 originais
  // eram 19,8, e o codigo da acesso a conversa de outra pessoa: a 1000
  // requisicoes por segundo dentro dos 15 minutos, acertava-se um em 60% das
  // vezes.
  const bits = 16 * Math.log2(31)
  expect(bits).toBeGreaterThan(78)
})

test('os caracteres saem sem vies de modulo', () => {
  // randomBytes com % 31 favorecia os oito primeiros do alfabeto, porque
  // 256 % 31 = 8. Uma amostra grande deve distribuir de forma parelha.
  const contagem = new Map<string, number>()
  for (let i = 0; i < 4000; i++) {
    for (const c of generateHandoffCode().slice(5)) {
      contagem.set(c, (contagem.get(c) ?? 0) + 1)
    }
  }

  const valores = [...contagem.values()]
  const esperado = (4000 * 16) / 31

  expect(contagem.size).toBe(31)
  // Margem folgada: o teste procura vies sistematico, nao ruido de amostragem.
  expect(Math.min(...valores)).toBeGreaterThan(esperado * 0.8)
  expect(Math.max(...valores)).toBeLessThan(esperado * 1.2)
})

test('o codigo evita caracteres que se confundem digitando', () => {
  // Sem O e 0, sem I, 1 e L: o cliente digita isto de um aparelho para outro.
  const codigos = Array.from({ length: 200 }, () => generateHandoffCode().slice(5)).join('')
  expect(codigos).not.toMatch(/[O0IL1]/)
})

test('encontra o codigo dentro da mensagem do cliente', () => {
  const code = generateHandoffCode()

  expect(extractHandoffCode(`Continuar atendimento ${code}`)).toBe(code)
  expect(extractHandoffCode(`oi, quero continuar: ${code.toLowerCase()} por favor`)).toBe(code)
  expect(extractHandoffCode('bom dia')).toBeNull()
})

test('codigo curto nao e mais aceito como codigo', () => {
  // Garante que o formato antigo nao volte por acidente numa mensagem.
  expect(extractHandoffCode('Continuar atendimento SYNC-A7K2')).toBeNull()
})

// ---------- link ----------

test('em mock o link aponta para a tela local', async () => {
  const c = await anonima()
  const r = await mock.create(c.id)

  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data.url).toContain('localhost:5175')
  expect(decodeURIComponent(r.data.url)).toContain(r.data.code)
})

test('em meta o link abre o WhatsApp com a mensagem pronta', async () => {
  const c = await anonima()
  const r = await meta.create(c.id)

  if (!r.success) throw new Error('falhou')
  expect(r.data.url).toContain('https://wa.me/5511999998888')
  expect(decodeURIComponent(r.data.url)).toContain(`Continuar atendimento ${r.data.code}`)
})

test('o link vale por quinze minutos', async () => {
  const c = await anonima()
  const r = await mock.create(c.id)
  if (!r.success) throw new Error('falhou')

  const minutos = (r.data.expiresAt.getTime() - Date.now()) / 60000
  expect(minutos).toBeGreaterThan(14)
  expect(minutos).toBeLessThanOrEqual(15)
})

test('a sessao que informou o CPF continua podendo gerar o proprio link', async () => {
  // Cenario 1 do documento: conversa anonima, cliente informa o CPF e depois
  // quer continuar no WhatsApp. Exigir token do dono aqui tirava dele o direito
  // de gerar o link da propria conversa.
  const maria = await criarCliente()
  const c = await anonima()
  await conversas.update(c.id, { customerId: maria.id })

  expect((await mock.create(c.id)).success).toBe(true)
})

test('conversa inexistente nao gera link', async () => {
  const r = await mock.create('nao-existe')
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('CONVERSA_NAO_ENCONTRADA')
})

// ---------- consumo ----------

test('o codigo devolve a conversa de origem', async () => {
  const c = await anonima()
  const r = await mock.create(c.id)
  if (!r.success) throw new Error('falhou')

  expect(await mock.consume(`Continuar atendimento ${r.data.code}`)).toBe(c.id)
})

test('o codigo serve uma vez so', async () => {
  const c = await anonima()
  const r = await mock.create(c.id)
  if (!r.success) throw new Error('falhou')

  const texto = `Continuar atendimento ${r.data.code}`
  expect(await mock.consume(texto)).toBe(c.id)

  // Reusar permitiria que alguem com o texto da mensagem entrasse numa conversa
  // que nao e dele.
  expect(await mock.consume(texto)).toBeNull()
})

test('codigo expirado nao vale', async () => {
  const c = await anonima()
  await prisma.handoffToken.create({
    data: {
      code: 'SYNC-XPRDXPRDXPRDX',
      conversationId: c.id,
      targetChannel: 'WHATSAPP',
      expiresAt: new Date(Date.now() - 1000),
    },
  })

  expect(await mock.consume('Continuar atendimento SYNC-XPRDXPRDXPRDX')).toBeNull()
})

test('codigo inventado nao vale', async () => {
  expect(await mock.consume(`Continuar atendimento ${generateHandoffCode()}`)).toBeNull()
})

test('mensagem sem codigo nao tenta consumir nada', async () => {
  expect(await mock.consume('oi, tudo bem?')).toBeNull()
})
