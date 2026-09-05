import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { PrismaCustomerRepository } from '../../context/customer.repository.js'
import { criarCliente, limparBase } from '../../testing/fixtures.js'
import { LoginUseCase } from '../login.use-case.js'
import { hashPassword } from '../password.js'
import { PrismaRefreshTokenRepository } from '../refresh-token.repository.js'
import { TokenService } from '../tokens.js'

const EMAIL = 'maria.silva@teste.local'
const SENHA = 'MinhaSenha123'

const tokens = new TokenService('segredo-de-teste-com-mais-de-32-caracteres')
const caso = new LoginUseCase(
  new PrismaCustomerRepository(prisma),
  new PrismaRefreshTokenRepository(prisma),
  tokens,
)

beforeEach(async () => {
  await limparBase()
  await criarCliente({ cpf: '12345678900', name: 'Maria Silva', email: EMAIL, password: SENHA })
})

afterAll(async () => {
  await prisma.$disconnect()
})

test('login válido devolve access e refresh', async () => {
  const r = await caso.execute({ email: EMAIL, password: SENHA })
  expect(r.success).toBe(true)
  if (!r.success) return

  expect(typeof r.data.accessToken).toBe('string')
  expect(typeof r.data.refreshToken).toBe('string')
  expect(r.data.customer.name).toBe('Maria Silva')
})

test('o access token carrega o id do cliente', async () => {
  const r = await caso.execute({ email: EMAIL, password: SENHA })
  if (!r.success) throw new Error('falhou')

  const verificado = await tokens.verifyAccess(r.data.accessToken)
  expect(verificado.success && verificado.data.subjectId).toBe(r.data.customer.id)
  expect(verificado.success && verificado.data.kind).toBe('CUSTOMER')
})

test('a resposta nunca inclui o hash da senha', async () => {
  const r = await caso.execute({ email: EMAIL, password: SENHA })
  if (!r.success) throw new Error('falhou')
  expect(JSON.stringify(r.data)).not.toContain('$argon2id$')
})

test('senha errada e e-mail inexistente dão exatamente o mesmo erro', async () => {
  const senhaErrada = await caso.execute({
    email: EMAIL,
    password: 'ErradaTotal',
  })
  const emailInexistente = await caso.execute({
    email: 'ninguem@exemplo.com',
    password: SENHA,
  })

  expect(senhaErrada.success).toBe(false)
  expect(emailInexistente.success).toBe(false)
  if (senhaErrada.success || emailInexistente.success) return

  // Se as mensagens diferissem, daria para descobrir quais e-mails têm conta.
  expect(senhaErrada.error).toEqual(emailInexistente.error)
  expect(senhaErrada.error.code).toBe('CREDENCIAIS_INVALIDAS')
})

test('quem ainda não fez o primeiro acesso não consegue logar', async () => {
  // Cliente da base sem senha definida: existe, mas ainda nao pode entrar.
  const semSenha = await criarCliente({ name: 'João Pereira' })

  const r = await caso.execute({ email: semSenha.email, password: 'QualquerCoisa1' })
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('CREDENCIAIS_INVALIDAS')
})

test('cada login abre uma família de refresh diferente', async () => {
  const a = await caso.execute({ email: EMAIL, password: SENHA })
  const b = await caso.execute({ email: EMAIL, password: SENHA })
  if (!a.success || !b.success) throw new Error('falhou')

  const repo = new PrismaRefreshTokenRepository(prisma)
  const tokenA = await repo.findValid(a.data.refreshToken)
  const tokenB = await repo.findValid(b.data.refreshToken)

  expect(tokenA?.familyId).not.toBe(tokenB?.familyId)
})
