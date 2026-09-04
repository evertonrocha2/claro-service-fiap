import { expect, test } from 'vitest'
import { ACCESS_TTL_SECONDS, hashRefreshToken, newRefreshToken, TokenService } from '../tokens.js'

const servico = new TokenService('segredo-de-teste-com-mais-de-32-caracteres')

test('assina e verifica um access token de cliente', async () => {
  const token = await servico.signAccess({ subjectId: 'c1', kind: 'CUSTOMER' })
  const r = await servico.verifyAccess(token)
  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data).toEqual({ subjectId: 'c1', kind: 'CUSTOMER' })
})

test('assina e verifica um access token de atendente', async () => {
  const token = await servico.signAccess({ subjectId: 'a1', kind: 'AGENT' })
  const r = await servico.verifyAccess(token)
  expect(r.success && r.data.kind).toBe('AGENT')
})

test('token adulterado é rejeitado', async () => {
  const token = await servico.signAccess({ subjectId: 'c1', kind: 'CUSTOMER' })
  const r = await servico.verifyAccess(`${token}x`)
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('TOKEN_INVALIDO')
})

test('token assinado com outro segredo é rejeitado', async () => {
  const outro = new TokenService('outro-segredo-com-mais-de-32-caracteres-aqui')
  const token = await outro.signAccess({ subjectId: 'c1', kind: 'CUSTOMER' })
  expect((await servico.verifyAccess(token)).success).toBe(false)
})

test('lixo no lugar do token é rejeitado sem estourar', async () => {
  expect((await servico.verifyAccess('nao-e-um-jwt')).success).toBe(false)
  expect((await servico.verifyAccess('')).success).toBe(false)
})

test('o access token expira em 15 minutos', () => {
  expect(ACCESS_TTL_SECONDS).toBe(15 * 60)
})

test('refresh token é opaco, aleatório e guardado só como hash', () => {
  const a = newRefreshToken()
  const b = newRefreshToken()
  expect(a).not.toBe(b)
  expect(a.length).toBeGreaterThanOrEqual(43)
  expect(hashRefreshToken(a)).toBe(hashRefreshToken(a))
  expect(hashRefreshToken(a)).not.toBe(a)
})
