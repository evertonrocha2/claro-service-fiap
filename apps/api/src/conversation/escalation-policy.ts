import type { Intent } from '@sync/contracts'
import type { Classification } from '../nlp/types.js'

export const LOW_CONFIDENCE_THRESHOLD = 0.6
export const MAX_CONSECUTIVE_UNKNOWN = 2

export type EscalationReason =
  | 'SENSITIVE_INTENT'
  | 'CUSTOMER_REQUEST'
  | 'LOW_CONFIDENCE'
  | 'REPEATED_UNKNOWN'

export type Decision =
  | { action: 'AUTO_REPLY'; intent: Intent }
  | { action: 'ESCALATE'; reason: EscalationReason }

export type DecideInput = {
  classification: Classification
  consecutiveUnknown: number
}

/**
 * A ordem das regras é o comportamento. DESCONHECIDA precisa ser tratada antes do
 * corte por confiança, porque tem confiança 0 por construção: sem isso o cliente
 * nunca teria a chance de reformular a primeira mensagem.
 */
export function decide({ classification, consecutiveUnknown }: DecideInput): Decision {
  const { intent, confidence } = classification

  if (intent === 'CANCELAMENTO') {
    return { action: 'ESCALATE', reason: 'SENSITIVE_INTENT' }
  }

  if (intent === 'FALAR_COM_ATENDENTE') {
    return { action: 'ESCALATE', reason: 'CUSTOMER_REQUEST' }
  }

  if (intent === 'DESCONHECIDA') {
    return consecutiveUnknown >= MAX_CONSECUTIVE_UNKNOWN
      ? { action: 'ESCALATE', reason: 'REPEATED_UNKNOWN' }
      : { action: 'AUTO_REPLY', intent: 'DESCONHECIDA' }
  }

  if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    return { action: 'ESCALATE', reason: 'LOW_CONFIDENCE' }
  }

  return { action: 'AUTO_REPLY', intent }
}
