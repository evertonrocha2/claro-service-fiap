import { expect, test, vi } from 'vitest'
import { GeminiClassifier } from '../gemini-classifier.js'

type Chamada = { url: string; init: RequestInit }

/** Registra a chamada num closure: `mock.calls` chega aqui sem tipo util. */
function respostaCom(texto: string, status = 200) {
  const chamadas: Chamada[] = []
  const impl = (async (url: string, init: RequestInit) => {
    chamadas.push({ url, init })
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: texto }] } }] }),
      { status, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch

  return { impl, chamadas }
}

function classificador(fetchImpl: typeof fetch) {
  return new GeminiClassifier({ apiKey: 'chave-de-teste', fetchImpl })
}

test('interpreta a resposta do modelo', async () => {
  const r = await classificador(
    respostaCom('{"intent":"CANCELAMENTO","confidence":0.91}').impl,
  ).classify({ text: 'quero encerrar tudo com voces' })

  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data.intent).toBe('CANCELAMENTO')
  expect(r.data.confidence).toBeCloseTo(0.91)
  expect(r.data.source).toBe('LLM')
})

test('aceita JSON embrulhado em cerca de markdown', async () => {
  const r = await classificador(
    respostaCom('```json\n{"intent":"CONSULTA_PLANO","confidence":0.8}\n```').impl,
  ).classify({ text: 'me fala do meu pacote' })

  expect(r.success && r.data.intent).toBe('CONSULTA_PLANO')
})

test('nenhum dado pessoal sai daqui: o corpo enviado vai redigido', async () => {
  const espiao = respostaCom('{"intent":"CANCELAMENTO","confidence":0.9}')

  await classificador(espiao.impl).classify({
    text: 'meu cpf é 123.456.789-00, fone (11) 98765-4321, quero cancelar',
  })

  const corpo = String(espiao.chamadas[0]?.init.body)
  expect(corpo).toContain('[CPF]')
  expect(corpo).toContain('[TELEFONE]')
  expect(corpo).not.toContain('123.456.789-00')
  expect(corpo).not.toContain('98765-4321')
})

test('as entidades reais continuam vindo, extraídas localmente', async () => {
  const r = await classificador(
    respostaCom('{"intent":"CANCELAMENTO","confidence":0.9}').impl,
  ).classify({ text: 'cpf 123.456.789-00, quero cancelar' })

  expect(r.success && r.data.entities.cpf).toBe('12345678900')
})

test('a chave vai no cabeçalho, nunca na URL', async () => {
  const espiao = respostaCom('{"intent":"DESCONHECIDA","confidence":0.1}')
  await classificador(espiao.impl).classify({ text: 'oi' })

  const chamada = espiao.chamadas[0]
  expect(chamada?.url).not.toContain('chave-de-teste')
  expect((chamada?.init.headers as Record<string, string>)['x-goog-api-key']).toBe(
    'chave-de-teste',
  )
})

test('intenção fora da taxonomia é rejeitada em vez de propagada', async () => {
  const r = await classificador(
    respostaCom('{"intent":"PEDIR_PIZZA","confidence":0.99}').impl,
  ).classify({ text: 'oi' })

  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('GEMINI_RESPOSTA_INVALIDA')
})

test('erro HTTP vira Result de falha, não exceção', async () => {
  const r = await classificador(
    (vi.fn(async () => new Response('quota', { status: 429 })) as unknown) as typeof fetch,
  ).classify({ text: 'oi' })

  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('GEMINI_INDISPONIVEL')
})

test('rede fora do ar vira Result de falha', async () => {
  const r = await classificador(
    (vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown) as typeof fetch,
  ).classify({ text: 'oi' })

  expect(r.success).toBe(false)
})

test('confiança fora de 0..1 é normalizada', async () => {
  const r = await classificador(
    respostaCom('{"intent":"CANCELAMENTO","confidence":5}').impl,
  ).classify({ text: 'cancelar' })

  expect(r.success && r.data.confidence).toBe(1)
})
