import { afterAll, expect, test } from 'vitest'
import { prisma } from '../client.js'

afterAll(async () => {
  await prisma.$disconnect()
})

test('o banco responde e a tabela Customer existe', async () => {
  const total = await prisma.customer.count()
  expect(total).toBeGreaterThanOrEqual(0)
})
