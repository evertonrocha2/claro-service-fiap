import type { ConversationStatus, InboundMessage, Intent, Result } from '@sync/contracts'
import { err, ok } from '@sync/contracts'
import type { Conversation, Customer } from '@sync/db'
import type {
  IConversationRepository,
  ICustomerRepository,
  IMessageRepository,
} from '../context/index.js'
import type { IIdentityService } from '../identity/identity.service.js'
import { extractEntities } from '../nlp/pii.js'
import type { IIntentClassifier } from '../nlp/types.js'
import { type ReplyContext, buildAutoReply, buildEscalationReply } from './auto-reply.js'
import { decide } from './escalation-policy.js'

export type HandleResult = {
  conversationId: string
  protocol: string
  reply: string
  intent: Intent
  status: ConversationStatus
}

/**
 * Componente "Conversação" do diagrama. Segue a ordem do diagrama de sequência do
 * Documento de Visão: identifica, carrega contexto, classifica, atualiza contexto,
 * decide entre responder ou escalar, devolve pelo canal de origem.
 */
export class ConversationOrchestrator {
  constructor(
    private readonly identity: IIdentityService,
    private readonly conversations: IConversationRepository,
    private readonly messages: IMessageRepository,
    private readonly customers: ICustomerRepository,
    private readonly classifier: IIntentClassifier,
  ) {}

  async handle(msg: InboundMessage): Promise<Result<HandleResult>> {
    const entidades = extractEntities(msg.text)

    const cliente = await this.identity.identify({
      customerId: msg.customerId,
      phone: msg.phone,
      cpf: entidades.cpf,
      protocol: entidades.protocol,
    })

    const conversa = await this.loadOrCreate(msg, cliente)

    // O contexto persistido vale quando a mensagem atual nao carrega identificacao.
    // Sem isso o cliente teria que reinformar o CPF a cada mensagem, que e
    // exatamente o problema que o Sync existe para resolver (RF004 e RF005).
    const clienteEfetivo =
      cliente ?? (conversa.customerId ? await this.customers.findById(conversa.customerId) : null)

    // A mensagem de entrada só é gravada depois da classificação, para já nascer
    // com intent e confidence preenchidos. Gravar antes exigiria um update logo em
    // seguida e deixaria uma linha sem intenção caso a classificação falhasse.
    const classificado = await this.classifier.classify({ text: msg.text })
    if (!classificado.success) {
      return err('CLASSIFICACAO_FALHOU', 'Não foi possível interpretar a mensagem.')
    }
    const classificacao = classificado.data

    await this.messages.append({
      conversationId: conversa.id,
      channel: msg.channel,
      direction: 'INBOUND',
      sender: 'CUSTOMER',
      text: msg.text,
      intent: classificacao.intent,
      confidence: classificacao.confidence,
    })

    const desconhecidasSeguidas =
      classificacao.intent === 'DESCONHECIDA' ? conversa.consecutiveUnknown + 1 : 0

    const decisao = decide({
      classification: classificacao,
      consecutiveUnknown: desconhecidasSeguidas,
    })

    const contexto = await this.buildReplyContext(clienteEfetivo)
    const resposta =
      decisao.action === 'AUTO_REPLY'
        ? buildAutoReply(decisao.intent, contexto)
        : buildEscalationReply(decisao.reason)

    const status: ConversationStatus = decisao.action === 'ESCALATE' ? 'WAITING_HUMAN' : 'BOT'

    const atualizada = await this.conversations.update(conversa.id, {
      intent: classificacao.intent,
      status,
      consecutiveUnknown: desconhecidasSeguidas,
      currentChannel: msg.channel,
      ...(clienteEfetivo && !conversa.customerId ? { customerId: clienteEfetivo.id } : {}),
      ...(conversa.firstResponseAt ? {} : { firstResponseAt: new Date() }),
    })

    await this.messages.append({
      conversationId: conversa.id,
      channel: msg.channel,
      direction: 'OUTBOUND',
      sender: 'BOT',
      text: resposta,
      intent: classificacao.intent,
      confidence: classificacao.confidence,
    })

    return ok({
      conversationId: atualizada.id,
      protocol: atualizada.protocol,
      reply: resposta,
      intent: classificacao.intent,
      status,
    })
  }

  private async loadOrCreate(msg: InboundMessage, cliente: Customer | null): Promise<Conversation> {
    if (msg.conversationId) {
      const porId = await this.conversations.findById(msg.conversationId)
      if (porId) return porId
    }

    if (cliente) {
      const aberta = await this.conversations.findOpenByCustomer(cliente.id)
      if (aberta) return aberta
    }

    return this.conversations.create({
      originChannel: msg.channel,
      currentChannel: msg.channel,
      ...(cliente ? { customerId: cliente.id } : {}),
    })
  }

  private async buildReplyContext(cliente: Customer | null): Promise<ReplyContext> {
    if (!cliente) return { identified: false, services: [] }

    const completo = await this.customers.findWithContext(cliente.id)
    if (!completo) return { identified: false, services: [] }

    const aberta = completo.invoices[0]

    return {
      identified: true,
      customerName: completo.name,
      services: completo.services.map((s) => ({ type: s.type, label: s.label })),
      ...(aberta ? { openInvoice: { dueDate: aberta.dueDate, barcode: aberta.barcode } } : {}),
    }
  }
}
