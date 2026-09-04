import { expect, test } from 'vitest'
import type { Classification } from '../../nlp/types.js'
import { decide } from '../escalation-policy.js'

function c(intent: Classification['intent'], confidence: number): Classification {
  return { intent, confidence, entities: {}, source: 'RULES' }
}

test('cancelamento sempre escala como intenção sensível', () => {
  expect(decide({ classification: c('CANCELAMENTO', 0.95), consecutiveUnknown: 0 })).toEqual({
    action: 'ESCALATE',
    reason: 'SENSITIVE_INTENT',
  })
})

test('pedido explícito de atendente escala', () => {
  expect(decide({ classification: c('FALAR_COM_ATENDENTE', 0.9), consecutiveUnknown: 0 })).toEqual({
    action: 'ESCALATE',
    reason: 'CUSTOMER_REQUEST',
  })
})

test('primeira mensagem desconhecida pede esclarecimento em vez de escalar', () => {
  expect(decide({ classification: c('DESCONHECIDA', 0), consecutiveUnknown: 0 })).toEqual({
    action: 'AUTO_REPLY',
    intent: 'DESCONHECIDA',
  })
})

test('segunda mensagem desconhecida seguida escala', () => {
  expect(decide({ classification: c('DESCONHECIDA', 0), consecutiveUnknown: 2 })).toEqual({
    action: 'ESCALATE',
    reason: 'REPEATED_UNKNOWN',
  })
})

test('confiança abaixo de 0.60 escala', () => {
  expect(decide({ classification: c('PROBLEMA_TECNICO', 0.5), consecutiveUnknown: 0 })).toEqual({
    action: 'ESCALATE',
    reason: 'LOW_CONFIDENCE',
  })
})

test('confiança exatamente 0.60 não escala', () => {
  expect(decide({ classification: c('PROBLEMA_TECNICO', 0.6), consecutiveUnknown: 0 })).toEqual({
    action: 'AUTO_REPLY',
    intent: 'PROBLEMA_TECNICO',
  })
})

test('intenção resolvível com alta confiança responde automaticamente', () => {
  expect(decide({ classification: c('FATURA_SEGUNDA_VIA', 0.9), consecutiveUnknown: 0 })).toEqual({
    action: 'AUTO_REPLY',
    intent: 'FATURA_SEGUNDA_VIA',
  })
})
