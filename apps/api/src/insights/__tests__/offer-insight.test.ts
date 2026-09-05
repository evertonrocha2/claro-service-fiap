import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test, vi } from 'vitest'
import {
  PrismaConversationRepository,
  PrismaCustomerRepository,
  PrismaMessageRepository,
} from '../../context/index.js'
import { criarClienteDoCenario, limparBase } from '../../testing/fixtures.js'
import {
  type CustomerProfile,
  GeminiOfferWriter,
  type IOfferWriter,
  OfferInsightService,
  parseRecommendation,
  recommendByRules,
} from '../offer-insight.service.js'

const conversas = new PrismaConversationRepository(prisma)
const mensagens = new PrismaMessageRepository(prisma)
const clientes = new PrismaCustomerRepository(prisma)

function perfil(over: Partial<CustomerProfile> = {}): CustomerProfile {
  return {
    serviceTypes: ['MOVEL'],
    serviceLabels: ['Plano movel final 9876'],
    openInvoices: 0,
    daysOverdue: 0,
    intents: [],
    currentIntent: null,
    messageCount: 2,
    crossedChannels: false,
    ...over,
  }
}

beforeEach(limparBase)

afterAll(async () => {
  await prisma.$disconnect()
})

// ---------- regras ----------

test('problema tecnico aberto vence qualquer venda', () => {
  const r = recommendByRules(perfil({ currentIntent: 'PROBLEMA_TECNICO', daysOverdue: 30 }))
  expect(r.offerKind).toBe('SUPORTE_TECNICO')
})

test('fatura atrasada vem antes de retencao', () => {
  const r = recommendByRules(
    perfil({ currentIntent: 'CANCELAMENTO', daysOverdue: 12, openInvoices: 2 }),
  )
  expect(r.offerKind).toBe('NEGOCIACAO_FATURA')
  expect(r.rationale).toContain('12 dias')
})

test('cancelamento sem pendencia vira retencao', () => {
  const r = recommendByRules(perfil({ currentIntent: 'CANCELAMENTO' }))
  expect(r.offerKind).toBe('RETENCAO')
})

test('cliente com mais de um servico recebe proposta de combo', () => {
  const r = recommendByRules(
    perfil({
      currentIntent: 'CANCELAMENTO',
      serviceTypes: ['MOVEL', 'INTERNET_RESIDENCIAL'],
      serviceLabels: ['Plano movel final 9876', 'Claro Net Fibra 500 Mega'],
    }),
  )
  expect(r.offerKind).toBe('RETENCAO')
  expect(r.headline).toContain('combo')
})

test('consulta de plano vira upgrade', () => {
  expect(recommendByRules(perfil({ currentIntent: 'CONSULTA_PLANO' })).offerKind).toBe('UPGRADE')
})

test('sem sinal nenhum a recomendacao e explicitamente nenhuma', () => {
  const r = recommendByRules(perfil())
  expect(r.offerKind).toBe('NENHUMA')
  expect(r.headline).toBeTruthy()
})

test('as regras sempre produzem texto, para a tela nunca ficar vazia', () => {
  for (const intent of ['CANCELAMENTO', 'CONSULTA_PLANO', 'PROBLEMA_TECNICO', null] as const) {
    const r = recommendByRules(perfil({ currentIntent: intent }))
    expect(r.headline.length).toBeGreaterThan(0)
    expect(r.rationale.length).toBeGreaterThan(0)
    expect(r.source).toBe('RULES')
  }
})

// ---------- leitura da resposta do modelo ----------

test('interpreta a recomendacao do modelo', () => {
  const r = parseRecommendation(
    '{"headline":"Oferecer 30% por 6 meses","rationale":"Cliente fiel","offerKind":"DESCONTO","confidence":0.82}',
  )
  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data.offerKind).toBe('DESCONTO')
  expect(r.data.source).toBe('LLM')
})

test('aceita JSON embrulhado em cerca de markdown', () => {
  const r = parseRecommendation(
    '```json\n{"headline":"a","rationale":"b","offerKind":"UPGRADE","confidence":0.5}\n```',
  )
  expect(r.success && r.data.offerKind).toBe('UPGRADE')
})

test('tipo de oferta inventado e recusado', () => {
  const r = parseRecommendation(
    '{"headline":"a","rationale":"b","offerKind":"DAR_UM_CARRO","confidence":1}',
  )
  expect(r.success).toBe(false)
})

test('texto longo e cortado em vez de recusado', () => {
  const r = parseRecommendation(
    `{"headline":"${'a'.repeat(200)}","rationale":"${'b'.repeat(900)}","offerKind":"UPGRADE","confidence":0.5}`,
  )
  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data.headline).toHaveLength(60)
  expect(r.data.rationale).toHaveLength(240)
})

test('recomendacao sem texto e recusada', () => {
  const r = parseRecommendation('{"headline":"","rationale":"","offerKind":"UPGRADE"}')
  expect(r.success).toBe(false)
})

// ---------- o que sai daqui para o Gemini ----------

test('o retrato enviado ao modelo nao carrega mensagem do cliente', async () => {
  const chamadas: { body: string }[] = []
  const fetchFalso = (async (_url: string, init: RequestInit) => {
    chamadas.push({ body: String(init.body) })
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"headline":"a","rationale":"b","offerKind":"RETENCAO","confidence":0.7}',
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    )
  }) as unknown as typeof fetch

  const writer = new GeminiOfferWriter('chave', 'modelo-de-teste', fetchFalso)
  await writer.write(perfil({ currentIntent: 'CANCELAMENTO' }))

  const enviado = chamadas[0]?.body ?? ''
  expect(enviado).toContain('CANCELAMENTO')
  expect(enviado).not.toContain('quero cancelar')
  expect(enviado).not.toContain('123.456.789-00')
})

test('a chave vai no cabecalho, nunca na URL', async () => {
  const urls: string[] = []
  const fetchFalso = (async (url: string) => {
    urls.push(url)
    return new Response('{}', { status: 500 })
  }) as unknown as typeof fetch

  await new GeminiOfferWriter('chave-secreta', 'm', fetchFalso).write(perfil())
  expect(urls[0]).not.toContain('chave-secreta')
})

// ---------- gravacao ----------

async function cenarioCancelamento() {
  // Fatura vencida de proposito: e ela que faz a regra escolher negociacao em
  // vez de retencao, e o teste abaixo verifica exatamente essa escolha.
  const criado = await criarClienteDoCenario({ fatura: { vencimentoEmDias: -107 } })
  const cliente = await clientes.findWithContext(criado.cliente.id)
  if (!cliente) throw new Error('cliente nao encontrado')

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
    text: 'quero cancelar meu plano',
    intent: 'CANCELAMENTO',
    confidence: 0.9,
  })
  await conversas.update(c.id, { intent: 'CANCELAMENTO', status: 'WAITING_HUMAN' })
  return { cliente, conversa: c }
}

test('grava a sugestao e devolve a mais recente do atendimento', async () => {
  const servico = new OfferInsightService(prisma, mensagens)
  const { cliente, conversa } = await cenarioCancelamento()

  const r = await servico.generate(cliente, conversa.id)
  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data.customerId).toBe(cliente.id)
  expect(r.data.source).toBe('RULES')

  const ultima = await servico.latestForConversation(conversa.id)
  expect(ultima?.id).toBe(r.data.id)
})

test('quando ha modelo, o texto dele substitui o das regras', async () => {
  const writer: IOfferWriter = {
    write: vi.fn(async () => ({
      success: true as const,
      data: {
        headline: 'Oferecer 40% por 12 meses',
        rationale: 'Cliente de longa data com dois servicos.',
        offerKind: 'DESCONTO' as const,
        confidence: 0.88,
        source: 'LLM' as const,
      },
    })),
  }

  const servico = new OfferInsightService(prisma, mensagens, writer)
  const { cliente, conversa } = await cenarioCancelamento()

  const r = await servico.generate(cliente, conversa.id)
  if (!r.success) throw new Error('falhou')
  expect(r.data.source).toBe('LLM')
  expect(r.data.headline).toBe('Oferecer 40% por 12 meses')
})

test('modelo fora do ar nao apaga a sugestao das regras', async () => {
  const writer: IOfferWriter = {
    write: vi.fn(async () => ({
      success: false as const,
      error: { code: 'GEMINI_INDISPONIVEL', message: 'caiu' },
    })),
  }

  const servico = new OfferInsightService(prisma, mensagens, writer)
  const { cliente, conversa } = await cenarioCancelamento()

  const r = await servico.generate(cliente, conversa.id)
  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data.source).toBe('RULES')

  // A cliente semeada tem fatura vencida em 20/05, entao a regra de divida
  // vence a de retencao. E o comportamento desejado: cobrar antes de descontar.
  expect(r.data.offerKind).toBe('NEGOCIACAO_FATURA')
  expect(r.data.headline).toBeTruthy()
})

test('atendimento inexistente devolve erro, nao estoura', async () => {
  const servico = new OfferInsightService(prisma, mensagens)
  const cliente = await clientes.findWithContext((await criarClienteDoCenario()).cliente.id)
  if (!cliente) throw new Error('cliente nao semeado')

  const r = await servico.generate(cliente, 'nao-existe')
  expect(r.success).toBe(false)
})
