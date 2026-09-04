import { type Result, err, ok } from '@sync/contracts'
import type { ICustomerRepository } from '../context/customer.repository.js'
import { hashPassword } from './password.js'

export const MIN_PASSWORD_LENGTH = 8

export type FirstAccessInput = {
  cpf: string
  email: string
  password: string
}

/**
 * Primeiro acesso, não cadastro.
 *
 * A base de clientes é semeada: você é cliente da Claro antes de ter login. Não
 * existe registro aberto porque uma conta criada do zero não teria plano nem
 * fatura sobre o que conversar. Aqui o cliente só prova que é ele, casando CPF e
 * e-mail contra um registro que já existe, e define a senha.
 */
export class FirstAccessUseCase {
  constructor(private readonly customers: ICustomerRepository) {}

  async execute(input: FirstAccessInput): Promise<Result<{ customerId: string }>> {
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      return err('SENHA_FRACA', `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`)
    }

    const cpf = input.cpf.replace(/\D/g, '')
    const cliente = await this.customers.findByCpf(cpf)

    // Mesmo erro para CPF inexistente e para e-mail que não confere. Distinguir os
    // dois entregaria de graça quais CPFs são clientes da Claro.
    const email = input.email.trim().toLowerCase()
    if (!cliente || cliente.email.toLowerCase() !== email) {
      return err('CADASTRO_NAO_CONFERE', 'Não encontramos um cadastro com esses dados.')
    }

    if (cliente.passwordHash) {
      return err(
        'PRIMEIRO_ACESSO_JA_FEITO',
        'Esta conta já tem senha. Use a opção de recuperação se esqueceu.',
      )
    }

    await this.customers.setPasswordHash(cliente.id, await hashPassword(input.password))

    return ok({ customerId: cliente.id })
  }
}
