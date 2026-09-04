import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { LogoutUseCase } from '../logout.use-case.js'
import { RefreshUseCase } from '../refresh.use-case.js'
import { PrismaRefreshTokenRepository } from '../refresh-token.repository.js'
import { newRefreshToken, REFRESH_TTL_SECONDS, TokenService } from '../tokens.js'

const repo = new PrismaRefreshTokenRepository(prisma)
const tokens = new TokenService('segredo-de-teste-com-mais-de-32-caracteres')
const refresh = new RefreshUseCase(repo, tokens)
const logout = new LogoutUseCase(repo)

async function primeiroToken() {
  const token = newRefreshToken()
  await repo.issue({
    token,
    subjectId: 'c1',
    subjectKind: 'CUSTOMER',
    ttlSeconds: REFRESH_TTL_SECONDS,
  })
  return token
}

beforeEach(async () => {
  await prisma.refreshToken.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

test('rotaciona: devolve access novo e refresh novo', async () => {
  const antigo = await primeiroToken()
  const r = await refresh.execute({ refreshToken: antigo })
  expect(r.success).toBe(true)
  if (!r.success) return

  expect(r.data.refreshToken).not.toBe(antigo)
  expect((await tokens.verifyAccess(r.data.accessToken)).success).toBe(true)
})

test('o token rotacionado fica na mesma família', async () => {
  const antigo = await primeiroToken()
  const familiaAntiga = (await repo.findValid(antigo))?.familyId

  const r = await refresh.execute({ refreshToken: antigo })
  if (!r.success) throw new Error('falhou')

  expect((await repo.findValid(r.data.refreshToken))?.familyId).toBe(familiaAntiga)
})

test('o token antigo deixa de valer depois da rotação', async () => {
  const antigo = await primeiroToken()
  await refresh.execute({ refreshToken: antigo })
  expect(await repo.findValid(antigo)).toBeNull()
})

test('reusar token já rotacionado revoga a família inteira', async () => {
  const primeiro = await primeiroToken()
  const r = await refresh.execute({ refreshToken: primeiro })
  if (!r.success) throw new Error('falhou')
  const segundo = r.data.refreshToken

  // Cenário de roubo: o atacante apresenta o token antigo que já foi usado.
  const ataque = await refresh.execute({ refreshToken: primeiro })
  expect(ataque.success).toBe(false)
  if (ataque.success) return
  expect(ataque.error.code).toBe('REFRESH_REUSADO')

  // O token legítimo da vítima também cai. É o comportamento correto: não dá
  // para saber qual das duas partes é a legítima, então derruba as duas.
  expect(await repo.findValid(segundo)).toBeNull()
})

test('token desconhecido é rejeitado', async () => {
  const r = await refresh.execute({ refreshToken: newRefreshToken() })
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('REFRESH_INVALIDO')
})

test('token expirado é rejeitado', async () => {
  const token = newRefreshToken()
  await repo.issue({ token, subjectId: 'c1', subjectKind: 'CUSTOMER', ttlSeconds: -1 })
  const r = await refresh.execute({ refreshToken: token })
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('REFRESH_INVALIDO')
})

test('logout revoga a família toda, não só o token apresentado', async () => {
  const primeiro = await primeiroToken()
  const r = await refresh.execute({ refreshToken: primeiro })
  if (!r.success) throw new Error('falhou')

  expect((await logout.execute({ refreshToken: r.data.refreshToken })).success).toBe(true)
  expect(await repo.findValid(r.data.refreshToken)).toBeNull()
})

test('logout com token desconhecido não estoura', async () => {
  expect((await logout.execute({ refreshToken: newRefreshToken() })).success).toBe(true)
})
