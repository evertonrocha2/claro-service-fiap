import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { PrismaCustomerRepository } from '../../context/customer.repository.js'
import { FirstAccessUseCase } from '../first-access.use-case.js'
import { verifyPassword } from '../password.js'

const caso = new FirstAccessUseCase(new PrismaCustomerRepository(prisma))

beforeEach(async () => {
  await prisma.customer.update({
    where: { cpf: '12345678900' },
    data: { passwordHash: null },
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

test('define a senha quando CPF e e-mail batem com um cadastro existente', async () => {
  const r = await caso.execute({
    cpf: '123.456.789-00',
    email: 'maria.silva@exemplo.com',
    password: 'MinhaSenha123',
  })
  expect(r.success).toBe(true)

  const cliente = await prisma.customer.findUniqueOrThrow({ where: { cpf: '12345678900' } })
  expect(cliente.passwordHash).not.toBeNull()
  expect(await verifyPassword(cliente.passwordHash ?? '', 'MinhaSenha123')).toBe(true)
})

test('aceita CPF com ou sem formatação', async () => {
  const r = await caso.execute({
    cpf: '12345678900',
    email: 'maria.silva@exemplo.com',
    password: 'MinhaSenha123',
  })
  expect(r.success).toBe(true)
})

test('o e-mail é comparado sem diferenciar caixa', async () => {
  const r = await caso.execute({
    cpf: '12345678900',
    email: '  MARIA.SILVA@Exemplo.COM ',
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
    email: 'maria.silva@exemplo.com',
    password: 'curta',
  })
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('SENHA_FRACA')
})

test('não deixa redefinir a senha de quem já fez o primeiro acesso', async () => {
  const dados = {
    cpf: '12345678900',
    email: 'maria.silva@exemplo.com',
    password: 'MinhaSenha123',
  }
  expect((await caso.execute(dados)).success).toBe(true)

  const segunda = await caso.execute({ ...dados, password: 'OutraSenha456' })
  expect(segunda.success).toBe(false)
  if (segunda.success) return
  expect(segunda.error.code).toBe('PRIMEIRO_ACESSO_JA_FEITO')
})
