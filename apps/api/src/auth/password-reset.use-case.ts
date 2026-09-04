import { randomInt } from 'node:crypto'
import { err, ok, type Result } from '@sync/contracts'
import type { PrismaClient } from '@sync/db'
import type { ICustomerRepository } from '../context/customer.repository.js'
import { hashPassword } from './password.js'
import type { IRefreshTokenRepository } from './refresh-token.repository.js'
import { hashRefreshToken } from './tokens.js'

export const MIN_PASSWORD_LENGTH = 8

/** Quinze minutos. Um código vivo vale uma conta, então não sobrevive à pausa do café. */
export const RESET_TTL_MS = 15 * 60 * 1000

/** Mesmo alfabeto do código de handoff: sem O, 0, I, 1 e L. Este aqui a pessoa digita. */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LEN = 8

/**
 * Oito caracteres, cerca de 39 bits.
 *
 * Mais curto que o de handoff de propósito: este chega por outro meio e é
 * digitado à mão. O que sustenta o número é o resto: uso único, quinze minutos,
 * e dez tentativas por quinze minutos na rota. Sem o limite de taxa, 39 bits
 * seria pouco.
 */
export function generateResetCode(): string {
  let codigo = ''
  for (let i = 0; i < CODE_LEN; i++) codigo += ALFABETO[randomInt(0, ALFABETO.length)]
  return codigo
}

export type RequestInput = { cpf: string; email: string }

export type RequestOutput = {
  /** Sempre true. A resposta não diz se a conta existe. */
  sent: true
  /**
   * O código, e só fora de produção.
   *
   * Não há serviço de e-mail neste MVP, e sem isto a recuperação seria uma tela
   * que não leva a lugar nenhum. Em produção o campo não existe e o código sai
   * apenas pelo canal de entrega.
   */
  devCode?: string
}

export type ConfirmInput = { code: string; password: string }

/**
 * Recuperação de senha.
 *
 * Existia a mensagem "use a opção de recuperação se esqueceu" e não existia a
 * opção. Quem fizesse o primeiro acesso e esquecesse a senha ficava sem conta,
 * porque o primeiro acesso se recusa a sobrescrever uma senha já definida, e com
 * razão: se ele sobrescrevesse, saber CPF e e-mail bastaria para tomar a conta.
 *
 * A troca é a mesma de qualquer recuperação real: a prova não é o que a pessoa
 * sabe, é o que ela recebe. CPF e e-mail apenas escolhem para onde o código vai.
 *
 * DÍVIDA CONSCIENTE, e a razão de o código voltar na resposta fora de produção:
 * não há remetente de e-mail nem de SMS neste projeto. Enquanto não houver, a
 * entrega é o log do servidor, e em desenvolvimento também a resposta, para a
 * tela poder ser demonstrada. Em produção `devCode` não é preenchido.
 */
export class PasswordResetUseCase {
  constructor(
    private readonly db: PrismaClient,
    private readonly customers: ICustomerRepository,
    private readonly refreshTokens: IRefreshTokenRepository,
    private readonly isProduction: boolean,
  ) {}

  async request(input: RequestInput): Promise<Result<RequestOutput>> {
    const cpf = input.cpf.replace(/\D/g, '')
    const email = input.email.trim().toLowerCase()

    const cliente = await this.customers.findByCpf(cpf)
    const confere = cliente !== null && cliente.email.toLowerCase() === email

    // A resposta é idêntica quando a conta não existe, quando o e-mail não
    // confere e quando tudo confere. Distinguir os casos transformaria esta rota
    // num verificador de quais CPFs são clientes da Claro.
    //
    // A ressalva honesta: fora de produção o `devCode` só aparece quando os
    // dados conferem, e isso por si distingue os casos. É aceitável porque em
    // produção o campo nunca é preenchido e as duas respostas ficam iguais ao
    // byte. Some junto com o `devCode` no dia em que houver envio de e-mail.
    if (!confere || !cliente) return ok({ sent: true })

    const code = generateResetCode()

    await this.db.passwordResetToken.create({
      data: {
        tokenHash: hashRefreshToken(code),
        customerId: cliente.id,
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    })

    // O log é a entrega enquanto não há e-mail. Fica no servidor, não na
    // resposta, e é o único caminho em produção.
    console.info(`[recuperacao] codigo ${code} para o cliente ${cliente.id}`)

    return ok(this.isProduction ? { sent: true } : { sent: true, devCode: code })
  }

  async confirm(input: ConfirmInput): Promise<Result<{ customerId: string }>> {
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      return err('SENHA_FRACA', `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`)
    }

    const code = input.code.trim().toUpperCase()

    // Marca como usado na mesma consulta que o encontra, como no handoff: entre
    // ler e gravar cabem duas requisições usando o mesmo código.
    const consumidos = await this.db.passwordResetToken.updateMany({
      where: { tokenHash: hashRefreshToken(code), usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    })

    if (consumidos.count === 0) {
      return err('CODIGO_INVALIDO', 'Código inválido ou expirado. Solicite um novo.')
    }

    const token = await this.db.passwordResetToken.findUnique({
      where: { tokenHash: hashRefreshToken(code) },
    })
    if (!token) return err('CODIGO_INVALIDO', 'Código inválido ou expirado. Solicite um novo.')

    await this.customers.setPasswordHash(token.customerId, await hashPassword(input.password))

    // Toda sessão antiga morre aqui. Trocar a senha e deixar a sessão de quem
    // usava a antiga viva esvazia o sentido de trocar.
    await this.refreshTokens.revokeAllForSubject(token.customerId, 'CUSTOMER')

    return ok({ customerId: token.customerId })
  }
}
