import { type Intent, ok, type Result } from '@sync/contracts'
import { extractEntities } from './pii.js'
import { RULES } from './rules.js'
import { normalize } from './text.js'
import type { Classification, ClassifyInput, IIntentClassifier } from './types.js'

export function confidenceFromScore(score: number): number {
  if (score <= 0) return 0
  if (score < 3) return 0.4 + score * 0.1
  return Math.min(0.8 + (score - 3) * 0.05, 0.95)
}

/**
 * Desempate de placar. Quem aparece antes vence. Intenções sensíveis vêm primeiro:
 * errar para o lado de escalar é barato, errar para o lado de responder sozinho não.
 */
const PRIORIDADE: Intent[] = [
  'CANCELAMENTO',
  'FALAR_COM_ATENDENTE',
  'FATURA_SEGUNDA_VIA',
  'PROBLEMA_TECNICO',
  'CONSULTA_PLANO',
  'DESCONHECIDA',
]

function venceEmpate(candidata: Intent, atual: Intent): boolean {
  return PRIORIDADE.indexOf(candidata) < PRIORIDADE.indexOf(atual)
}

export class RuleClassifier implements IIntentClassifier {
  async classify(input: ClassifyInput): Promise<Result<Classification>> {
    const texto = normalize(input.text)
    const placar = new Map<Intent, number>()

    for (const regra of RULES) {
      if (!texto.includes(regra.keyword)) continue
      placar.set(regra.intent, (placar.get(regra.intent) ?? 0) + regra.weight)
    }

    let melhorIntencao: Intent = 'DESCONHECIDA'
    let melhorPlacar = 0
    for (const [intencao, valor] of placar) {
      if (
        valor > melhorPlacar ||
        (valor === melhorPlacar && venceEmpate(intencao, melhorIntencao))
      ) {
        melhorPlacar = valor
        melhorIntencao = intencao
      }
    }

    return ok({
      intent: melhorIntencao,
      confidence: confidenceFromScore(melhorPlacar),
      entities: extractEntities(input.text),
      source: 'RULES',
    })
  }
}
