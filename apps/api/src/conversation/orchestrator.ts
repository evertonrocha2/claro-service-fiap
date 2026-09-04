import type { Channel, ConversationStatus, InboundMessage, Intent, Result } from '@sync/contracts'
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
import {
  buildAutoReply,
  buildEscalationReply,
  buildHandoffReply,
  type ReplyContext,
} from './auto-reply.js'
import { decide } from './escalation-policy.js'
import type { HandoffUseCase } from './handoff.use-case.js'

export type HandleResult = {
  conversationId: string
  protocol: string
  /**
   * Nulo quando um humano esta no comando da conversa.
   *
   * A partir do escalonamento o Sync cala a boca. Antes ele respondia por cima
   * do atendente: a pessoa pedia o nome do cliente, o cliente respondia, e o bot
   * emendava "vou passar para um atendente" com um atendente ja falando ali.
   */
  reply: string | null
  intent: Intent
  status: ConversationStatus
  /**
   * O que o Sync sabe da jornada neste momento.
   *
   * Vai na resposta porque a interface mostra isso ao cliente o tempo todo: e o
   * RF004 tornado visivel, e tambem uma garantia de transparencia sob a LGPD, ja
   * que a pessoa ve exatamente qual dado dela esta guardado na conversa.
   */
  context: {
    identified: boolean
    customerName: string | null
    channel: Channel
    originChannel: Channel
    intent: Intent | null
    serviceLabel: string | null
  }
}

/**
 * Componente "Conversação" do diagrama. Segue a ordem do diagrama de sequência do
 * Documento de Visão: identifica, carrega contexto, classifica, atualiza contexto,
 * decide entre responder ou escalar, devolve pelo canal de origem.
 */
/** Status em que a conversa pertence a uma pessoa, nao ao bot. */
const SOB_COMANDO_HUMANO: ConversationStatus[] = ['WAITING_HUMAN', 'WITH_HUMAN']

export class ConversationOrchestrator {
  constructor(
    private readonly identity: IIdentityService,
    private readonly conversations: IConversationRepository,
    private readonly messages: IMessageRepository,
    private readonly customers: ICustomerRepository,
    private readonly classifier: IIntentClassifier,
    private readonly handoff?: HandoffUseCase,
  ) {}

  /**
   * Marca que esta mensagem apenas atravessou de canal.
   *
   * "Continuar atendimento SYNC-XXXX" e controle, nao pedido: classificada como
   * DESCONHECIDA, ela apagava o assunto original e o card do atendente perdia o
   * motivo do contato justamente na troca de canal.
   */
  private veioDeHandoff = false

  async handle(msg: InboundMessage): Promise<Result<HandleResult>> {
    this.veioDeHandoff = false
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

    const contexto = await this.buildReplyContext(clienteEfetivo)

    // A mensagem que atravessa de canal e controle, nao pedido. Responde com a
    // frase de continuidade e grava o telefone do canal novo, senao a proxima
    // mensagem do mesmo numero abriria outro atendimento.
    if (this.veioDeHandoff) {
      const atualizada = await this.conversations.update(conversa.id, {
        currentChannel: msg.channel,
        ...(msg.phone ? { contactPhone: msg.phone } : {}),
        ...(clienteEfetivo && !conversa.customerId ? { customerId: clienteEfetivo.id } : {}),
      })

      const resposta = buildHandoffReply(conversa.originChannel, conversa.intent, contexto)

      await this.messages.append({
        conversationId: conversa.id,
        channel: msg.channel,
        direction: 'OUTBOUND',
        sender: 'BOT',
        text: resposta,
        ...(conversa.intent ? { intent: conversa.intent } : {}),
      })

      return ok({
        conversationId: atualizada.id,
        protocol: atualizada.protocol,
        reply: resposta,
        intent: atualizada.intent ?? 'DESCONHECIDA',
        status: atualizada.status,
        context: this.buildContextPayload(msg, atualizada, contexto, atualizada.intent),
      })
    }

    // Da escalada em diante quem conduz e a pessoa. O Sync registra a mensagem,
    // mantem o assunto congelado e nao escreve nada: duas vozes na mesma
    // conversa se contradizem, e foi o que acontecia.
    if (SOB_COMANDO_HUMANO.includes(conversa.status)) {
      const atualizada = await this.conversations.update(conversa.id, {
        currentChannel: msg.channel,
        ...(clienteEfetivo && !conversa.customerId ? { customerId: clienteEfetivo.id } : {}),
      })

      return ok({
        conversationId: atualizada.id,
        protocol: atualizada.protocol,
        reply: null,
        intent: atualizada.intent ?? classificacao.intent,
        status: atualizada.status,
        context: this.buildContextPayload(msg, atualizada, contexto, atualizada.intent),
      })
    }

    const desconhecidasSeguidas =
      classificacao.intent === 'DESCONHECIDA' ? conversa.consecutiveUnknown + 1 : 0

    const decisao = decide({
      classification: classificacao,
      consecutiveUnknown: desconhecidasSeguidas,
    })

    const resposta =
      decisao.action === 'AUTO_REPLY'
        ? buildAutoReply(decisao.intent, contexto)
        : buildEscalationReply(decisao.reason)

    const status: ConversationStatus = decisao.action === 'ESCALATE' ? 'WAITING_HUMAN' : 'BOT'

    const assunto = this.veioDeHandoff
      ? (conversa.intent ?? classificacao.intent)
      : classificacao.intent

    const atualizada = await this.conversations.update(conversa.id, {
      intent: assunto,
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
      intent: assunto,
      status,
      context: this.buildContextPayload(msg, atualizada, contexto, assunto),
    })
  }

  private buildContextPayload(
    msg: InboundMessage,
    conversa: Conversation,
    contexto: ReplyContext,
    intent: Intent | null,
  ): HandleResult['context'] {
    const servicoRelacionado =
      intent === 'PROBLEMA_TECNICO'
        ? (contexto.services.find((s) => s.type === 'INTERNET_RESIDENCIAL') ?? contexto.services[0])
        : contexto.services[0]

    return {
      identified: contexto.identified,
      customerName: contexto.customerName ?? null,
      channel: msg.channel,
      originChannel: conversa.originChannel,
      intent: intent === 'DESCONHECIDA' ? null : intent,
      serviceLabel: contexto.identified ? (servicoRelacionado?.label ?? null) : null,
    }
  }

  private async loadOrCreate(msg: InboundMessage, cliente: Customer | null): Promise<Conversation> {
    // O codigo do link vem antes de tudo. E a intencao explicita do cliente de
    // continuar aquele atendimento, e vence qualquer heuristica de telefone.
    const porCodigo = await this.handoff?.consume(msg.text)
    if (porCodigo) {
      const retomada = await this.conversations.findById(porCodigo)
      if (retomada) {
        this.veioDeHandoff = true
        return retomada
      }
    }

    if (msg.conversationId) {
      const porId = await this.conversations.findById(msg.conversationId)
      if (porId) return porId
    }

    if (cliente) {
      const aberta = await this.conversations.findOpenByCustomer(cliente.id)
      if (aberta) return aberta
    }

    // Chegou do WhatsApp e o numero bate com um atendimento aberto do site.
    // E aqui que o RF005 acontece entre canais para quem nao fez login: o
    // telefone informado no chat e a unica ponte que os dois canais dividem.
    if (msg.phone) {
      const porTelefone = await this.conversations.findOpenByPhone(msg.phone)
      if (porTelefone) return porTelefone
    }

    return this.conversations.create({
      originChannel: msg.channel,
      currentChannel: msg.channel,
      ...(cliente ? { customerId: cliente.id } : {}),
      ...(msg.phone ? { contactPhone: msg.phone } : {}),
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
