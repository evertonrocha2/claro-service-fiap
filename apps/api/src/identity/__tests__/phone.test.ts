import { expect, test } from 'vitest'
import { formatPhone, normalizePhone } from '../phone.js'

test.each([
  ['(11) 98765-4321', '+5511987654321'],
  ['11987654321', '+5511987654321'],
  ['11 98765 4321', '+5511987654321'],
  ['+55 11 98765-4321', '+5511987654321'],
  ['5511987654321', '+5511987654321'],
  ['(11) 3456-7890', '+551134567890'],
])('normaliza "%s"', (entrada, esperado) => {
  const r = normalizePhone(entrada)
  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data).toBe(esperado)
})

test('o mesmo número escrito de formas diferentes gera a mesma chave', () => {
  const formas = ['(11) 98765-4321', '11987654321', '+55 11 98765 4321', '55 11 98765-4321']
  const chaves = new Set(
    formas.map((f) => {
      const r = normalizePhone(f)
      return r.success ? r.data : f
    }),
  )
  expect(chaves.size).toBe(1)
})

test.each([['123'], ['1198765'], ['0198765432'], ['abc'], ['']])(
  'recusa "%s" em vez de adivinhar',
  (entrada) => {
    const r = normalizePhone(entrada)
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.error.code).toBe('TELEFONE_INVALIDO')
  },
)

test('formata para leitura', () => {
  expect(formatPhone('+5511987654321')).toBe('(11) 98765-4321')
  expect(formatPhone('+551134567890')).toBe('(11) 3456-7890')
})
