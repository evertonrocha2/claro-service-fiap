import type { Customer } from '@sync/db'
import type { IConversationRepository } from '../context/conversation.repository.js'
import type { ICustomerRepository } from '../context/customer.repository.js'

export type IdentifyInput = {
  customerId?: string
  phone?: string
  cpf?: string
  protocol?: string
}

export interface IIdentityService {
  identify(input: IdentifyInput): Promise<Customer | null>
}

/**
 * Ordem de resolução, da fonte mais confiável para a menos: customerId vem de um
 * token autenticado, phone vem dos metadados do canal, cpf e protocol vêm do que o
 * cliente digitou e portanto podem estar errados ou ser de outra pessoa.
 */
export class IdentityService implements IIdentityService {
  constructor(
    private readonly customers: ICustomerRepository,
    private readonly conversations: IConversationRepository,
  ) {}

  async identify(input: IdentifyInput): Promise<Customer | null> {
    if (input.customerId) {
      const porId = await this.customers.findById(input.customerId)
      if (porId) return porId
    }

    if (input.phone) {
      const porTelefone = await this.customers.findByPhone(input.phone)
      if (porTelefone) return porTelefone
    }

    if (input.cpf) {
      const porCpf = await this.customers.findByCpf(input.cpf)
      if (porCpf) return porCpf
    }

    if (input.protocol) {
      const conversa = await this.conversations.findByProtocol(input.protocol)
      if (conversa?.customerId) return this.customers.findById(conversa.customerId)
    }

    return null
  }
}
