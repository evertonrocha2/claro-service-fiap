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
import { assertPodeAcessar, type Requester } from './access.js'

export type PublicMessage = {
  id: string
  sender: 'CUSTOMER' | 'BOT' | 'AGENT'
  text: string
  at: Date
  /**
   * Canal onde esta mensagem aconteceu.
   *
   * A conversa e uma so no banco, e e isso que da contexto ao atendente. Mas
   * cada canal do cliente mostra somente o que passou por ele: o WhatsApp da
   * pessoa nao tem, e nao deveria ter, o historico digitado no site.
   */
  channel: Channel
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
 * Acesso: cliente autenticado le apenas a conversa dele; sessao anonima le com
 * o id. A regra e explicada em access.ts.
 *
 * O id é um cuid imprevisível, entregue apenas a quem participa dela. Exigir
 * token do dono parecia mais seguro e quebrava o fluxo principal: quem conversa
 * anônimo e informa o CPF no meio, que é um caminho previsto no RF002, passava a
 * ser dono e a própria sessão do site perdia o histórico da tela no instante
 * seguinte.
 *
 * Isto não é a falha do telefone que corrigimos antes. Lá o problema era
 * escrever identidade: digitar o número de outra pessoa transformava a conversa
 * em dela. Aqui é só leitura de uma conversa cujo endereço secreto já se tem.
 *
 * O que fica em aberto: um id vazado expõe aquela conversa, e apenas ela. Para
 * produção o caminho é um segredo por conversa com prazo, entregue a quem a
 * criou. Anotado como dívida consciente.
 */
export class ReadConversationUseCase {
  constructor(
    private readonly conversations: IConversationRepository,
    private readonly messages: IMessageRepository,
    private readonly customers: ICustomerRepository,
  ) {}

  async execute(
    conversationId: string,
    requester?: Requester,
  ): Promise<Result<PublicConversation>> {
    const conversa = await this.conversations.findById(conversationId)
    if (!conversa) {
      return err('CONVERSA_NAO_ENCONTRADA', 'Não encontramos este atendimento.')
    }

    const permitido = assertPodeAcessar(conversa.customerId, requester)
    if (!permitido.success) return permitido

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
        channel: m.channel,
      })),
    })
  }
}
