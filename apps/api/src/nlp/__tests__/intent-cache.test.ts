import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { PrismaIntentCacheRepository, cacheKey } from '../intent-cache.repository.js'

const cache = new PrismaIntentCacheRepository(prisma)

beforeEach(async () => {
  await prisma.intentCache.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

test('a chave é um hash, não o texto', () => {
  const chave = cacheKey('quero cancelar')
  expect(chave).toHaveLength(64)
  expect(chave).not.toContain('cancelar')
})

test('guarda e recupera uma classificação', async () => {
  await cache.save('quero cancelar', {
    intent: 'CANCELAMENTO',
    confidence: 0.93,
    entities: { cpf: undefined },
  })

  const achado = await cache.find('quero cancelar')
  expect(achado?.intent).toBe('CANCELAMENTO')
  expect(achado?.confidence).toBeCloseTo(0.93)
})

test('texto nunca visto devolve null', async () => {
  expect(await cache.find('frase inedita')).toBeNull()
})

test('conta os acertos, para dar pra medir a economia de chamadas', async () => {
  await cache.save('quero cancelar', { intent: 'CANCELAMENTO', confidence: 0.9, entities: {} })

  await cache.find('quero cancelar')
  await cache.find('quero cancelar')

  const linha = await prisma.intentCache.findUniqueOrThrow({
    where: { textHash: cacheKey('quero cancelar') },
  })
  expect(linha.hits).toBe(2)
})

test('salvar de novo o mesmo texto atualiza em vez de duplicar', async () => {
  await cache.save('oi', { intent: 'DESCONHECIDA', confidence: 0, entities: {} })
  await cache.save('oi', { intent: 'CONSULTA_PLANO', confidence: 0.88, entities: {} })

  expect(await prisma.intentCache.count()).toBe(1)
  expect((await cache.find('oi'))?.intent).toBe('CONSULTA_PLANO')
})
