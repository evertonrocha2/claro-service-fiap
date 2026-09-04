import { type Result, ok } from '@sync/contracts'
import type { IIntentCacheRepository } from './intent-cache.repository.js'
import { redact } from './pii.js'
import type { Classification, ClassifyInput, IIntentClassifier } from './types.js'

export const RULE_ACCEPT_THRESHOLD = 0.8

export type HybridOptions = {
  rules: IIntentClassifier
  cache: IIntentCacheRepository
  /** Ausente quando não há GEMINI_API_KEY. O sistema segue funcionando só com regras. */
  llm?: IIntentClassifier
}

/**
 * Regras primeiro, cache no meio, LLM só no que sobra.
 *
 * A ordem não é estética, é economia. O tier gratuito do Gemini é apertado, então
 * toda mensagem que uma palavra-chave forte já resolve nunca chega à rede. O cache
 * pega as repetições. O LLM fica para a frase torta, que é onde ele ganha das
 * regras de verdade.
 *
 * Falha do LLM nunca derruba o atendimento: cai de volta no palpite das regras.
 */
export class HybridClassifier implements IIntentClassifier {
  constructor(private readonly options: HybridOptions) {}

  async classify(input: ClassifyInput): Promise<Result<Classification>> {
    const porRegras = await this.options.rules.classify(input)

    if (porRegras.success && porRegras.data.confidence >= RULE_ACCEPT_THRESHOLD) {
      return porRegras
    }

    const redigido = redact(input.text)

    const emCache = await this.options.cache.find(redigido)
    if (emCache) {
      return ok({
        intent: emCache.intent,
        confidence: emCache.confidence,
        entities: porRegras.success ? porRegras.data.entities : emCache.entities,
        source: 'CACHE',
      })
    }

    if (!this.options.llm) return porRegras

    const porLlm = await this.options.llm.classify(input)
    if (!porLlm.success) return porRegras

    await this.options.cache.save(redigido, {
      intent: porLlm.data.intent,
      confidence: porLlm.data.confidence,
      entities: {},
    })

    return porLlm
  }
}
