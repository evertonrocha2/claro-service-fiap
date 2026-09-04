import { expect, test, vi } from 'vitest'
import { HybridClassifier } from '../hybrid-classifier.js'
import type { IIntentCacheRepository } from '../intent-cache.repository.js'
import { RuleClassifier } from '../rule-classifier.js'
import type { Classification, IIntentClassifier } from '../types.js'

function cacheFalso(inicial: Record<string, Classification> = {}) {
  const dados = new Map(Object.entries(inicial))
  const repo: IIntentCacheRepository = {
    find: vi.fn(async (t: string) => {
      const v = dados.get(t)
      return v ? { intent: v.intent, confidence: v.confidence, entities: v.entities } : null
    }),
    save: vi.fn(async (t: string, v) => {
      dados.set(t, { ...v, source: 'CACHE' })
    }),
  }
  return { repo, dados }
}

function llmFalso(intent: Classification['intent'], confidence = 0.9): IIntentClassifier {
  return {
    classify: vi.fn(async () => ({
      success: true as const,
      data: { intent, confidence, entities: {}, source: 'LLM' as const },
    })),
  }
}

test('palavra-chave forte resolve nas regras e o LLM nem é chamado', async () => {
  const llm = llmFalso('DESCONHECIDA')
  const { repo } = cacheFalso()

  const r = await new HybridClassifier({ rules: new RuleClassifier(), cache: repo, llm }).classify({
    text: 'quero cancelar meu plano',
  })

  expect(r.success && r.data.intent).toBe('CANCELAMENTO')
  expect(r.success && r.data.source).toBe('RULES')
  expect(llm.classify).not.toHaveBeenCalled()
  expect(repo.find).not.toHaveBeenCalled()
})

test('frase que as regras não resolvem cai no LLM', async () => {
  const llm = llmFalso('PROBLEMA_TECNICO', 0.87)
  const { repo } = cacheFalso()

  const r = await new HybridClassifier({ rules: new RuleClassifier(), cache: repo, llm }).classify({
    text: 'ta tudo travando aqui em casa desde ontem',
  })

  expect(r.success && r.data.intent).toBe('PROBLEMA_TECNICO')
  expect(r.success && r.data.source).toBe('LLM')
  expect(llm.classify).toHaveBeenCalledOnce()
})

test('o resultado do LLM vai para o cache', async () => {
  const llm = llmFalso('CONSULTA_PLANO')
  const { repo, dados } = cacheFalso()

  await new HybridClassifier({ rules: new RuleClassifier(), cache: repo, llm }).classify({
    text: 'me explica o que eu contratei',
  })

  expect(repo.save).toHaveBeenCalledOnce()
  expect(dados.size).toBe(1)
})

test('a segunda vez da mesma frase vem do cache, sem tocar o LLM', async () => {
  const llm = llmFalso('CONSULTA_PLANO')
  const { repo } = cacheFalso()
  const hibrido = new HybridClassifier({ rules: new RuleClassifier(), cache: repo, llm })

  await hibrido.classify({ text: 'me explica o que eu contratei' })
  const segunda = await hibrido.classify({ text: 'me explica o que eu contratei' })

  expect(llm.classify).toHaveBeenCalledOnce()
  expect(segunda.success && segunda.data.source).toBe('CACHE')
})

test('o cache ignora a diferença de CPF entre duas pessoas', async () => {
  const llm = llmFalso('FATURA_SEGUNDA_VIA')
  const { repo } = cacheFalso()
  const hibrido = new HybridClassifier({ rules: new RuleClassifier(), cache: repo, llm })

  await hibrido.classify({ text: 'aqui é 111.222.333-44, me manda aquilo pra pagar' })
  const outra = await hibrido.classify({ text: 'aqui é 999.888.777-66, me manda aquilo pra pagar' })

  // Redigidos, os dois textos são idênticos. Uma pessoa aproveita a chamada da outra.
  expect(llm.classify).toHaveBeenCalledOnce()
  expect(outra.success && outra.data.source).toBe('CACHE')
})

test('LLM fora do ar não derruba o atendimento, volta para as regras', async () => {
  const llm: IIntentClassifier = {
    classify: vi.fn(async () => ({
      success: false as const,
      error: { code: 'GEMINI_INDISPONIVEL', message: 'caiu' },
    })),
  }
  const { repo } = cacheFalso()

  const r = await new HybridClassifier({ rules: new RuleClassifier(), cache: repo, llm }).classify({
    text: 'ta tudo travando aqui em casa',
  })

  expect(r.success).toBe(true)
  expect(r.success && r.data.source).toBe('RULES')
  expect(repo.save).not.toHaveBeenCalled()
})

test('sem chave do Gemini o sistema roda só com regras', async () => {
  const { repo } = cacheFalso()

  const r = await new HybridClassifier({ rules: new RuleClassifier(), cache: repo }).classify({
    text: 'ta tudo travando aqui em casa',
  })

  expect(r.success).toBe(true)
  expect(r.success && r.data.source).toBe('RULES')
})

test('as entidades locais vencem as do cache, porque são desta mensagem', async () => {
  const llm = llmFalso('FATURA_SEGUNDA_VIA')
  const { repo } = cacheFalso()
  const hibrido = new HybridClassifier({ rules: new RuleClassifier(), cache: repo, llm })

  await hibrido.classify({ text: 'aqui é 111.222.333-44, me manda aquilo pra pagar' })
  const outra = await hibrido.classify({ text: 'aqui é 999.888.777-66, me manda aquilo pra pagar' })

  expect(outra.success && outra.data.entities.cpf).toBe('99988877766')
})
