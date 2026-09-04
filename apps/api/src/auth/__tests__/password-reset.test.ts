import { prisma } from '@sync/db'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { PrismaCustomerRepository } from '../../context/index.js'
import { hashPassword, verifyPassword } from '../password.js'
import {
  generateResetCode,
  PasswordResetUseCase,
  RESET_TTL_MS,
} from '../password-reset.use-case.js'
import { PrismaRefreshTokenRepository } from '../refresh-token.repository.js'
import { hashRefreshToken, newRefreshToken } from '../tokens.js'

const clientes = new PrismaCustomerRepository(prisma)
const refreshTokens = new PrismaRefreshTokenRepository(prisma)

const caso = new PasswordResetUseCase(prisma, clientes, refreshTokens, false)
const emProducao = new PasswordResetUseCase(prisma, clientes, refreshTokens, true)

const CPF = '12345678900'
const EMAIL = 'maria.silva@exemplo.com'

async function maria() {
  return prisma.customer.findUniqueOrThrow({ where: { cpf: CPF } })
}

beforeEach(async () => {
  await prisma.passwordResetToken.deleteMany()
  await prisma.refreshToken.deleteMany()
  // A Maria comeca com senha definida: recuperar so faz sentido para quem tem uma.
  await prisma.customer.update({
    where: { cpf: CPF },
    data: { passwordHash: await hashPassword('SenhaAntiga123') },
  })
})

afterAll(async () => {
  await prisma.customer.update({ where: { cpf: CPF }, data: { passwordHash: null } })
  await prisma.passwordResetToken.deleteMany()
  await prisma.$disconnect()
})

// ---------- codigo ----------

test('o codigo evita caracteres que se confundem digitando', () => {
  // Diferente do handoff, este a pessoa digita a mao.
  const amostra = Array.from({ length: 200 }, generateResetCode).join('')
  expect(amostra).not.toMatch(/[O0IL1]/)
  expect(generateResetCode()).toMatch(/^[A-Z2-9]{8}$/)
})

test('o codigo nao repete', () => {
  const cem = new Set(Array.from({ length: 100 }, generateResetCode))
  expect(cem.size).toBe(100)
})

// ---------- pedido ----------

test('cria o codigo quando CPF e e-mail conferem', async () => {
  const r = await caso.request({ cpf: '123.456.789-00', email: 'Maria.Silva@Exemplo.com' })

  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data.devCode).toMatch(/^[A-Z2-9]{8}$/)

  const guardado = await prisma.passwordResetToken.findFirst()
  expect(guardado).not.toBeNull()

  // Guarda o hash, nao o codigo. Vazar o banco nao deve entregar contas.
  expect(guardado?.tokenHash).toBe(hashRefreshToken(r.data.devCode ?? ''))
  expect(guardado?.tokenHash).not.toBe(r.data.devCode)
})

test('nao diz se a conta existe', async () => {
  // Se a resposta mudasse, esta rota viraria um verificador de quais CPFs sao
  // clientes da Claro: bastava varrer.
  const inexistente = await caso.request({ cpf: '00000000000', email: 'ninguem@exemplo.com' })
  const emailErrado = await caso.request({ cpf: CPF, email: 'outro@exemplo.com' })
  const certo = await caso.request({ cpf: CPF, email: EMAIL })

  expect(inexistente.success && inexistente.data.sent).toBe(true)
  expect(emailErrado.success && emailErrado.data.sent).toBe(true)
  expect(certo.success && certo.data.sent).toBe(true)

  // E nenhum codigo foi criado para os dois primeiros.
  expect(await prisma.passwordResetToken.count()).toBe(1)
})

test('em producao as duas respostas sao iguais ao byte', async () => {
  // Fora de producao o devCode aparece so quando os dados conferem, e isso
  // distingue os casos. E o preco de nao haver remetente de e-mail. O que nao
  // pode e vazar em producao, e e isto que o teste trava.
  const inexistente = await emProducao.request({ cpf: '00000000000', email: 'ninguem@exemplo.com' })
  const certo = await emProducao.request({ cpf: CPF, email: EMAIL })

  expect(JSON.stringify(inexistente)).toBe(JSON.stringify(certo))
})

test('em producao o codigo nao volta na resposta', async () => {
  // Fora de producao ele volta porque nao existe remetente de e-mail e a tela
  // precisa funcionar. Em producao isso entregaria a conta a quem sabe CPF e
  // e-mail, que nao sao segredo.
  const r = await emProducao.request({ cpf: CPF, email: EMAIL })

  expect(r.success).toBe(true)
  if (!r.success) return
  expect(r.data.devCode).toBeUndefined()

  // O codigo existe no banco: a entrega e que sai por outro canal.
  expect(await prisma.passwordResetToken.count()).toBe(1)
})

test('o codigo vale por quinze minutos', async () => {
  await caso.request({ cpf: CPF, email: EMAIL })
  const t = await prisma.passwordResetToken.findFirstOrThrow()

  const restante = t.expiresAt.getTime() - Date.now()
  expect(restante).toBeGreaterThan(RESET_TTL_MS - 5000)
  expect(restante).toBeLessThanOrEqual(RESET_TTL_MS)
})

// ---------- confirmacao ----------

async function pedirCodigo(): Promise<string> {
  const r = await caso.request({ cpf: CPF, email: EMAIL })
  if (!r.success || !r.data.devCode) throw new Error('sem codigo')
  return r.data.devCode
}

test('troca a senha e a nova entra', async () => {
  const code = await pedirCodigo()

  const r = await caso.confirm({ code, password: 'SenhaNova123' })
  expect(r.success).toBe(true)

  const depois = await maria()
  expect(await verifyPassword(depois.passwordHash ?? '', 'SenhaNova123')).toBe(true)
  expect(await verifyPassword(depois.passwordHash ?? '', 'SenhaAntiga123')).toBe(false)
})

test('aceita o codigo em minusculas e com espacos', async () => {
  const code = await pedirCodigo()
  expect(
    (await caso.confirm({ code: ` ${code.toLowerCase()} `, password: 'SenhaNova123' })).success,
  ).toBe(true)
})

test('o codigo serve uma vez so', async () => {
  const code = await pedirCodigo()

  expect((await caso.confirm({ code, password: 'SenhaNova123' })).success).toBe(true)

  const segunda = await caso.confirm({ code, password: 'OutraSenha456' })
  expect(segunda.success).toBe(false)
  if (segunda.success) return
  expect(segunda.error.code).toBe('CODIGO_INVALIDO')

  // A segunda senha nao pegou.
  const depois = await maria()
  expect(await verifyPassword(depois.passwordHash ?? '', 'OutraSenha456')).toBe(false)
})

test('codigo expirado nao vale', async () => {
  const cliente = await maria()
  await prisma.passwordResetToken.create({
    data: {
      tokenHash: hashRefreshToken('EXPIRADO'),
      customerId: cliente.id,
      expiresAt: new Date(Date.now() - 1000),
    },
  })

  const r = await caso.confirm({ code: 'EXPIRADO', password: 'SenhaNova123' })
  expect(r.success).toBe(false)
})

test('codigo inventado nao vale', async () => {
  const r = await caso.confirm({ code: generateResetCode(), password: 'SenhaNova123' })
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('CODIGO_INVALIDO')
})

test('recusa senha curta sem gastar o codigo', async () => {
  const code = await pedirCodigo()

  const r = await caso.confirm({ code, password: 'curta' })
  expect(r.success).toBe(false)
  if (r.success) return
  expect(r.error.code).toBe('SENHA_FRACA')

  // O codigo continua servindo: recusar por senha fraca e erro do formulario,
  // nao motivo para a pessoa pedir outro codigo.
  expect((await caso.confirm({ code, password: 'SenhaNova123' })).success).toBe(true)
})

test('trocar a senha derruba as sessoes antigas', async () => {
  // Sem isto, quem estivesse com a sessao aberta usando a senha antiga
  // continuava dentro, e trocar a senha nao resolvia nada.
  const cliente = await maria()
  const antigo = newRefreshToken()
  await refreshTokens.issue({
    token: antigo,
    subjectId: cliente.id,
    subjectKind: 'CUSTOMER',
    ttlSeconds: 3600,
  })

  expect(await refreshTokens.findValid(antigo)).not.toBeNull()

  const code = await pedirCodigo()
  await caso.confirm({ code, password: 'SenhaNova123' })

  expect(await refreshTokens.findValid(antigo)).toBeNull()
})
