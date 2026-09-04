import { prisma } from '@sync/db'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { PrismaCustomerRepository } from '../../context/customer.repository.js'
import { LoginUseCase } from '../login.use-case.js'
import { hashPassword } from '../password.js'
import { PrismaRefreshTokenRepository } from '../refresh-token.repository.js'
import { TokenService } from '../tokens.js'

const tokens = new TokenService('segredo-de-teste-com-mais-de-32-caracteres')
const caso = new LoginUseCase(
  new PrismaCustomerRepository(prisma),
  new PrismaRefreshTokenRepository(prisma),
  tokens,
)

beforeAll(async () => {
  await prisma.customer.update({
    where: { cpf: '12345678900' },
    data: { passwordHash: await hashPassword('MinhaSenha123') },
  })
})

beforeEach(async () => {
  await prisma.refreshToken.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

test('login válido devolve access e refresh', async () => {
  const r = await caso.execute({ email: 'maria.silva@exemplo.com', password: 'MinhaSenha123' })
  expect(r.success).toBe(true)
  if (!r.success) return

  expect(typeof r.data.accessToken).toBe('string')
  expect(typeof r.data.refreshToken).toBe('string')
  expect(r.data.customer.name).toBe('Maria Silva')
})

test('o access token carrega o id do cliente', async () => {
  const r = await caso.execute({ email: 'maria.silva@exemplo.com', password: 'MinhaSenha123' })
  if (!r.success) throw new Error('falhou')

  const verificado = await tokens.verifyAccess(r.data.accessToken)
  expect(verificado.success && verificado.data.subjectId).toBe(r.data.customer.id)
  expect(verificado.success && verificado.data.kind).toBe('CUSTOMER')
})

test('a resposta nunca inclui o hash da senha', async () => {
  const r = await caso.execute({ email: 'maria.silva@exemplo.com', password: 'MinhaSenha123' })
  if (!r.success) throw new Error('falhou')
  expect(JSON.stringify(r.data)).not.toContain('$argon2id$')
})

test('senha errada e e-mail inexistente dão exatamente o mesmo erro', async () => {
  const senhaErrada = await caso.execute({
    email: 'maria.silva@exemplo.com',
    password: 'ErradaTotal',
  })
  const emailInexistente = await caso.execute({
    email: 'ninguem@exemplo.com',
    password: 'MinhaSenha123',
  })

  expect(senhaErrada.success).toBe(false)
  expect(emailInexistente.success).toBe(false)
  if (senhaErrada.success || emailInexistente.success) return

  // Se as mensagens diferissem, daria para descobrir quais e-mails têm conta.
  expect(senhaErrada.error).toEqual(emailInexistente.error)
  expect(senhaErrada.error.code).toBe('CREDENCIAIS_INVALIDAS')
})

test('quem ainda não fez o primeiro acesso não consegue logar', async () => {
  await prisma.customer.update({ where: { cpf: '98765432100' }, data: { passwordHash: null } })
  const r = await caso.execute({ email: 'joao.pereira@exemplo.com', password: 'QualquerCoisa1' })
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('CREDENCIAIS_INVALIDAS')
})

test('cada login abre uma família de refresh diferente', async () => {
  const a = await caso.execute({ email: 'maria.silva@exemplo.com', password: 'MinhaSenha123' })
  const b = await caso.execute({ email: 'maria.silva@exemplo.com', password: 'MinhaSenha123' })
  if (!a.success || !b.success) throw new Error('falhou')

  const repo = new PrismaRefreshTokenRepository(prisma)
  const tokenA = await repo.findValid(a.data.refreshToken)
  const tokenB = await repo.findValid(b.data.refreshToken)

  expect(tokenA?.familyId).not.toBe(tokenB?.familyId)
})
