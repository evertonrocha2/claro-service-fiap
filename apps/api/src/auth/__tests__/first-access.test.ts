import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { PrismaCustomerRepository } from '../../context/customer.repository.js'
import { criarCliente, limparBase } from '../../testing/fixtures.js'
import { FirstAccessUseCase } from '../first-access.use-case.js'
import { verifyPassword } from '../password.js'

const caso = new FirstAccessUseCase(new PrismaCustomerRepository(prisma))

const CPF = '12345678900'
const EMAIL = 'maria.silva@teste.local'

// O primeiro acesso so faz sentido para uma conta que ainda nao tem senha,
// entao o cliente nasce sem hash a cada teste.
beforeEach(async () => {
  await limparBase()
  await criarCliente({ cpf: CPF, email: EMAIL, name: 'Maria Silva' })
})

afterAll(async () => {
  await prisma.$disconnect()
})

test('define a senha quando CPF e e-mail batem com um cadastro existente', async () => {
  const r = await caso.execute({
    cpf: '123.456.789-00',
    email: EMAIL,
    password: 'MinhaSenha123',
  })
  expect(r.success).toBe(true)

  const cliente = await prisma.customer.findUniqueOrThrow({ where: { cpf: CPF } })
  expect(cliente.passwordHash).not.toBeNull()
  expect(await verifyPassword(cliente.passwordHash ?? '', 'MinhaSenha123')).toBe(true)
})

test('aceita CPF com ou sem formatação', async () => {
  const r = await caso.execute({
    cpf: '12345678900',
    email: EMAIL,
    password: 'MinhaSenha123',
  })
  expect(r.success).toBe(true)
})

test('o e-mail é comparado sem diferenciar caixa', async () => {
  const r = await caso.execute({
    cpf: '12345678900',
    email: `  ${EMAIL.toUpperCase()} `,
    password: 'MinhaSenha123',
  })
  expect(r.success).toBe(true)
})

test('CPF inexistente falha sem revelar que o cadastro não existe', async () => {
  const r = await caso.execute({
    cpf: '00000000000',
    email: 'qualquer@exemplo.com',
    password: 'MinhaSenha123',
  })
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('CADASTRO_NAO_CONFERE')
})

test('e-mail que não bate com o CPF dá o mesmo erro genérico', async () => {
  const r = await caso.execute({
    cpf: '12345678900',
    email: 'joao.pereira@exemplo.com',
    password: 'MinhaSenha123',
  })
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('CADASTRO_NAO_CONFERE')
})

test('senha curta demais é rejeitada', async () => {
  const r = await caso.execute({
    cpf: '12345678900',
    email: EMAIL,
    password: 'curta',
  })
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('SENHA_FRACA')
})

test('não deixa redefinir a senha de quem já fez o primeiro acesso', async () => {
  const dados = {
    cpf: '12345678900',
    email: EMAIL,
    password: 'MinhaSenha123',
  }
  expect((await caso.execute(dados)).success).toBe(true)

  const segunda = await caso.execute({ ...dados, password: 'OutraSenha456' })
  expect(segunda.success).toBe(false)
  if (segunda.success) return
  expect(segunda.error.code).toBe('PRIMEIRO_ACESSO_JA_FEITO')
})
