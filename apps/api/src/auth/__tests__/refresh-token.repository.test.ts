import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { PrismaRefreshTokenRepository } from '../refresh-token.repository.js'
import { hashRefreshToken, newRefreshToken } from '../tokens.js'

const repo = new PrismaRefreshTokenRepository(prisma)

beforeEach(async () => {
  await prisma.refreshToken.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function emitir(familyId?: string) {
  const token = newRefreshToken()
  const gravado = await repo.issue({
    token,
    subjectId: 'c1',
    subjectKind: 'CUSTOMER',
    familyId,
    ttlSeconds: 3600,
  })
  return { token, gravado }
}

test('emite guardando o hash, nunca o token cru', async () => {
  const { token, gravado } = await emitir()
  expect(gravado.tokenHash).toBe(hashRefreshToken(token))
  expect(gravado.tokenHash).not.toBe(token)
})

test('emitir sem familyId abre uma família nova', async () => {
  const { gravado } = await emitir()
  expect(gravado.familyId).toBe(gravado.id)
})

test('encontra token válido pelo valor cru', async () => {
  const { token } = await emitir()
  expect((await repo.findValid(token))?.subjectId).toBe('c1')
})

test('token expirado não é encontrado', async () => {
  const token = newRefreshToken()
  await repo.issue({ token, subjectId: 'c1', subjectKind: 'CUSTOMER', ttlSeconds: -1 })
  expect(await repo.findValid(token)).toBeNull()
})

test('token já usado não é encontrado', async () => {
  const { token, gravado } = await emitir()
  await repo.markUsed(gravado.id)
  expect(await repo.findValid(token)).toBeNull()
})

test('revogar a família derruba todos os tokens dela', async () => {
  const primeiro = await emitir()
  const segundo = await emitir(primeiro.gravado.familyId)

  await repo.revokeFamily(primeiro.gravado.familyId)

  expect(await repo.findValid(primeiro.token)).toBeNull()
  expect(await repo.findValid(segundo.token)).toBeNull()
})

test('revogar uma família não afeta outra', async () => {
  const familiaA = await emitir()
  const familiaB = await emitir()

  await repo.revokeFamily(familiaA.gravado.familyId)

  expect(await repo.findValid(familiaA.token)).toBeNull()
  expect(await repo.findValid(familiaB.token)).not.toBeNull()
})

test('encontra token já usado, para detectar reuso', async () => {
  const { token, gravado } = await emitir()
  await repo.markUsed(gravado.id)
  const achado = await repo.findAny(token)
  expect(achado?.id).toBe(gravado.id)
  expect(achado?.usedAt).not.toBeNull()
})
