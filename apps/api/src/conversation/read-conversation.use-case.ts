import {
  type Channel,
  type ConversationStatus,
  err,
  type Intent,
  ok,
  type Result,
} from '@sync/contracts'
import type {
  IConversationRepository,
  ICustomerRepository,
  IMessageRepository,
} from '../context/index.js'

export type PublicMessage = {
  id: string
  sender: 'CUSTOMER' | 'BOT' | 'AGENT'
  text: string
  at: Date
}

export type PublicConversation = {
  conversationId: string
  protocol: string
  status: ConversationStatus
  context: {
    identified: boolean
    customerName: string | null
    channel: Channel
    originChannel: Channel
    intent: Intent | null
    serviceLabel: string | null
  }
  messages: PublicMessage[]
}

/**
 * Devolve uma conversa para o próprio cliente.
 *
 * Existe por dois motivos. O primeiro é continuidade: sem isto, recarregar a
 * página começava uma conversa nova e o histórico sumia da tela, ainda que
 * estivesse salvo. O segundo é mais sério: a resposta do atendente ficava só no
 * console e nunca chegava a quem esperava por ela.
 *
 * Acesso: conversa sem cliente é anônima e o próprio id, que é imprevisível,
 * funciona como segredo. Conversa com cliente exige token daquele cliente.
 */
export class ReadConversationUseCase {
  constructor(
    private readonly conversations: IConversationRepository,
    private readonly messages: IMessageRepository,
    private readonly customers: ICustomerRepository,
  ) {}

  async execute(
    conversationId: string,
    requesterCustomerId?: string,
  ): Promise<Result<PublicConversation>> {
    const conversa = await this.conversations.findById(conversationId)
    if (!conversa) {
      return err('CONVERSA_NAO_ENCONTRADA', 'Não encontramos este atendimento.')
    }

    if (conversa.customerId && conversa.customerId !== requesterCustomerId) {
      return err('CONVERSA_DE_OUTRO_CLIENTE', 'Este atendimento não é seu.')
    }

    const [mensagens, cliente] = await Promise.all([
      this.messages.listByConversation(conversationId),
      conversa.customerId ? this.customers.findWithContext(conversa.customerId) : null,
    ])

    const servico =
      cliente?.services.find((s) => s.id === conversa.serviceId) ?? cliente?.services[0]

    return ok({
      conversationId: conversa.id,
      protocol: conversa.protocol,
      status: conversa.status,
      context: {
        identified: cliente !== null,
        customerName: cliente?.name ?? null,
        channel: conversa.currentChannel,
        originChannel: conversa.originChannel,
        intent: conversa.intent === 'DESCONHECIDA' ? null : conversa.intent,
        serviceLabel: cliente ? (servico?.label ?? null) : null,
      },
      messages: mensagens.map((m) => ({
        id: m.id,
        sender: m.sender,
        text: m.text,
        at: m.createdAt,
      })),
    })
  }
}
