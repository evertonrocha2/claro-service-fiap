import { expect, test } from 'vitest'
import { normalizeWebPayload } from '../normalizer.js'

const agora = new Date('2026-09-03T12:00:00.000Z')

test('normaliza payload do site', () => {
  const r = normalizeWebPayload('SITE', { text: 'oi' }, {}, agora)
  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data).toEqual({ channel: 'SITE', text: 'oi', receivedAt: agora })
})

test('propaga customerId do contexto autenticado', () => {
  const r = normalizeWebPayload('APP', { text: 'oi' }, { customerId: 'abc' }, agora)
  expect(r.success && r.data.customerId).toBe('abc')
})

test('propaga conversationId do payload', () => {
  const r = normalizeWebPayload('SITE', { text: 'oi', conversationId: 'c1' }, {}, agora)
  expect(r.success && r.data.conversationId).toBe('c1')
})

test('rejeita payload sem texto com código de erro', () => {
  const r = normalizeWebPayload('SITE', {}, {}, agora)
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('PAYLOAD_INVALIDO')
})

test('rejeita canal WhatsApp por esta porta', () => {
  const r = normalizeWebPayload('WHATSAPP', { text: 'oi' }, {}, agora)
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('CANAL_INVALIDO')
})
