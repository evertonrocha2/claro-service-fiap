import { expect, test } from 'vitest'
import { hashPassword, verifyPassword } from '../password.js'

test('o hash não é a senha em texto claro', async () => {
  const hash = await hashPassword('senhaSegura123')
  expect(hash).not.toContain('senhaSegura123')
  expect(hash.startsWith('$argon2id$')).toBe(true)
})

test('a senha correta verifica', async () => {
  const hash = await hashPassword('senhaSegura123')
  expect(await verifyPassword(hash, 'senhaSegura123')).toBe(true)
})

test('a senha errada não verifica', async () => {
  const hash = await hashPassword('senhaSegura123')
  expect(await verifyPassword(hash, 'senhaErrada')).toBe(false)
})

test('o mesmo texto gera hashes diferentes, porque o salt é aleatório', async () => {
  const [a, b] = await Promise.all([hashPassword('igual'), hashPassword('igual')])
  expect(a).not.toBe(b)
})

test('hash malformado devolve false em vez de estourar', async () => {
  expect(await verifyPassword('nao-e-um-hash', 'qualquer')).toBe(false)
})
