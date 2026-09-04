import { err, ok, type Result } from '@sync/contracts'
import type { IConversationRepository, ICustomerRepository } from '../context/index.js'
import { normalizePhone } from '../identity/phone.js'

/**
 * Registra o telefone de contato de um atendimento.
 *
 * Sem isto, quem conversa no site sem estar logado não tem como ser reconhecido
 * ao escrever no WhatsApp depois, e o atendimento recomeça do zero. O número é a
 * única chave que os dois canais compartilham.
 *
 * Se o número já pertence a um cliente cadastrado, a conversa passa a ser dele:
 * informar o telefone acaba servindo de identificação.
 */
export class SetContactUseCase {
  constructor(
    private readonly conversations: IConversationRepository,
    private readonly customers: ICustomerRepository,
  ) {}

  async execute(
    conversationId: string,
    phoneBruto: string,
    requesterCustomerId?: string,
  ): Promise<Result<{ phone: string; identified: boolean }>> {
    const normalizado = normalizePhone(phoneBruto)
    if (!normalizado.success) return normalizado

    const conversa = await this.conversations.findById(conversationId)
    if (!conversa) {
      return err('CONVERSA_NAO_ENCONTRADA', 'Não encontramos este atendimento.')
    }

    if (conversa.customerId && conversa.customerId !== requesterCustomerId) {
      return err('CONVERSA_DE_OUTRO_CLIENTE', 'Este atendimento não é seu.')
    }

    const phone = normalizado.data
    const dono = await this.customers.findByPhone(phone)

    await this.conversations.update(conversationId, {
      contactPhone: phone,
      ...(dono && !conversa.customerId ? { customerId: dono.id } : {}),
    })

    return ok({ phone, identified: dono !== null })
  }
}
