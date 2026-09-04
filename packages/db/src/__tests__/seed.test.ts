import { afterAll, expect, test } from 'vitest'
import { prisma } from '../client.js'

afterAll(async () => {
  await prisma.$disconnect()
})

test('o cliente dos cenários está semeado com serviços e fatura', async () => {
  const cliente = await prisma.customer.findUnique({
    where: { cpf: '12345678900' },
    include: { services: true, invoices: true },
  })

  expect(cliente).not.toBeNull()
  expect(cliente?.phone).toBe('+5511987654321')
  expect(cliente?.services.map((s) => s.type).sort()).toEqual(['INTERNET_RESIDENCIAL', 'MOVEL'])
  expect(cliente?.services.some((s) => s.label === 'Plano móvel final 9876')).toBe(true)

  const aberta = cliente?.invoices.find((i) => i.status === 'OPEN')
  expect(aberta).toBeDefined()
  expect(aberta?.dueDate.toISOString().slice(0, 10)).toBe('2026-05-20')
})
