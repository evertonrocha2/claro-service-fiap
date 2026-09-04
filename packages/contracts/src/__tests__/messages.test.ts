import { expect, test } from 'vitest'
import { webChannelPayloadSchema } from '../messages.js'
import { err, ok } from '../result.js'

test('aceita payload web válido', () => {
  const r = webChannelPayloadSchema.safeParse({ text: 'minha internet está caindo' })
  expect(r.success).toBe(true)
})

test('rejeita texto vazio', () => {
  const r = webChannelPayloadSchema.safeParse({ text: '' })
  expect(r.success).toBe(false)
})

test('rejeita texto acima de 2000 caracteres', () => {
  const r = webChannelPayloadSchema.safeParse({ text: 'a'.repeat(2001) })
  expect(r.success).toBe(false)
})

test('ok e err produzem o discriminante correto', () => {
  expect(ok(1)).toEqual({ success: true, data: 1 })
  expect(err('X', 'y')).toEqual({ success: false, error: { code: 'X', message: 'y' } })
})
