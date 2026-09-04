import type { Channel, ConversationStatus, Intent, Result } from '@sync/contracts'
import { err, ok } from '@sync/contracts'
import type { PrismaClient } from '@sync/db'
import type { ICustomerRepository, IMessageRepository } from '../context/index.js'
import type { OfferInsightService } from '../insights/offer-insight.service.js'

export type QueueFilters = {
  status?: ConversationStatus
  channel?: Channel
  intent?: Intent
}

export type QueueItem = {
  id: string
  protocol: string
  customerName: string | null
  channel: Channel
  originChannel: Channel
  intent: Intent | null
  status: ConversationStatus
  serviceLabel: string | null
  waitingSeconds: number
  lastMessage: string | null
  assignedAgentName: string | null
}

export type OfferSuggestion = {
  headline: string
  rationale: string
  offerKind: string
  confidence: number
  source: string
  createdAt: Date
}

export type ConversationDetail = QueueItem & {
  assignedAgentId: string | null
  customerCpfMasked: string | null
  customerEmail: string | null
  customerPhone: string | null
  /** Sugestão de oferta, quando já houver uma para este atendimento. */
  offer: OfferSuggestion | null
  messages: {
    id: string
    sender: 'CUSTOMER' | 'BOT' | 'AGENT'
    channel: Channel
    text: string
    at: Date
  }[]
}

export type Metrics = {
  waiting: number
  withAgent: number
  withBot: number
  resolvedToday: number
  botResolutionRate: number
  worstWaitSeconds: number
  channelHandoffs: number
  byIntent: { intent: Intent; waiting: number }[]
  byChannel: { channel: Channel; total: number }[]
}

/**
 * O CPF nunca chega inteiro na interface do atendente.
 *
 * Ele só precisa confirmar identidade, e para isso os quatro dígitos do meio
 * bastam. Minimizar o dado exposto é a exigência da LGPD que mais aparece numa
 * tela de operação, porque é a tela que mais gente vê.
 */
export function maskCpf(cpf: string): string {
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`
}

/** O quadro e a fila humana. Conversa ainda com a IA nao espera ninguem. */
const PRECISAM_DE_GENTE: ConversationStatus[] = ['WAITING_HUMAN', 'WITH_HUMAN']

export class AdminService {
  constructor(
    private readonly db: PrismaClient,
    private readonly messages: IMessageRepository,
    private readonly offers?: OfferInsightService,
    private readonly customers?: ICustomerRepository,
  ) {}

  async queue(filters: QueueFilters, now = new Date()): Promise<QueueItem[]> {
    const conversas = await this.db.conversation.findMany({
      where: {
        status: filters.status ? filters.status : { in: PRECISAM_DE_GENTE },
        ...(filters.channel ? { currentChannel: filters.channel } : {}),
        ...(filters.intent ? { intent: filters.intent } : {}),
      },
      include: {
        customer: true,
        service: true,
        agent: true,
        // Só mensagem do cliente: o card precisa mostrar o problema, não a
        // última fala do bot, que é sempre a mesma frase de escalonamento.
        messages: {
          where: { sender: 'CUSTOMER' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'asc' },
    })

    return conversas.map((c) => ({
      id: c.id,
      protocol: c.protocol,
      customerName: c.customer?.name ?? null,
      channel: c.currentChannel,
      originChannel: c.originChannel,
      intent: c.intent,
      status: c.status,
      serviceLabel: c.service?.label ?? null,
      waitingSeconds: Math.max(0, Math.floor((now.getTime() - c.updatedAt.getTime()) / 1000)),
      lastMessage: c.messages[0]?.text ?? null,
      assignedAgentName: c.agent?.name ?? null,
    }))
  }

  async detail(id: string, now = new Date()): Promise<Result<ConversationDetail>> {
    const c = await this.db.conversation.findUnique({
      where: { id },
      include: { customer: true, service: true, agent: true },
    })
    if (!c) return err('ATENDIMENTO_NAO_ENCONTRADO', 'Este atendimento não existe.')

    const [mensagens, oferta] = await Promise.all([
      this.messages.listByConversation(id),
      this.offers?.latestForConversation(id) ?? null,
    ])

    return ok({
      id: c.id,
      protocol: c.protocol,
      customerName: c.customer?.name ?? null,
      customerCpfMasked: c.customer ? maskCpf(c.customer.cpf) : null,
      customerEmail: c.customer?.email ?? null,
      customerPhone: c.customer?.phone ?? c.contactPhone ?? null,
      offer: oferta
        ? {
            headline: oferta.headline,
            rationale: oferta.rationale,
            offerKind: oferta.offerKind,
            confidence: oferta.confidence,
            source: oferta.source,
            createdAt: oferta.createdAt,
          }
        : null,
      channel: c.currentChannel,
      originChannel: c.originChannel,
      intent: c.intent,
      status: c.status,
      serviceLabel: c.service?.label ?? null,
      waitingSeconds: Math.max(0, Math.floor((now.getTime() - c.updatedAt.getTime()) / 1000)),
      lastMessage: mensagens.findLast((m) => m.sender === 'CUSTOMER')?.text ?? null,
      assignedAgentName: c.agent?.name ?? null,
      assignedAgentId: c.assignedAgentId,
      messages: mensagens.map((m) => ({
        id: m.id,
        sender: m.sender,
        channel: m.channel,
        text: m.text,
        at: m.createdAt,
      })),
    })
  }

  /** Assumir é uma corrida: dois atendentes clicam no mesmo card ao mesmo tempo. */
  async claim(id: string, agentId: string): Promise<Result<{ ok: true }>> {
    const atualizados = await this.db.conversation.updateMany({
      where: { id, status: 'WAITING_HUMAN' },
      data: { status: 'WITH_HUMAN', assignedAgentId: agentId },
    })

    if (atualizados.count === 0) {
      return err('ATENDIMENTO_JA_ASSUMIDO', 'Outro atendente assumiu este atendimento.')
    }

    await this.gerarSugestao(id)
    return ok({ ok: true })
  }

  /**
   * Monta a sugestão de oferta no instante em que o atendente assume.
   *
   * É quando ela serve: a pessoa acabou de abrir uma conversa de cancelamento e
   * tem segundos para decidir o que oferecer. Gerar antes gastaria chamada em
   * atendimento que a IA ia resolver sozinha.
   *
   * Falha aqui não bloqueia o atendimento. Sem cliente identificado também não
   * há o que sugerir, e isso não é erro.
   */
  private async gerarSugestao(conversationId: string): Promise<void> {
    if (!this.offers || !this.customers) return

    const conversa = await this.db.conversation.findUnique({ where: { id: conversationId } })
    if (!conversa?.customerId) return

    const cliente = await this.customers.findWithContext(conversa.customerId)
    if (!cliente) return

    await this.offers.generate(cliente, conversationId)
  }

  /** Recalcula a sugestão a pedido do atendente. */
  async refreshOffer(conversationId: string): Promise<Result<{ ok: true }>> {
    if (!this.offers || !this.customers) {
      return err('SUGESTAO_INDISPONIVEL', 'Sugestão de oferta não está configurada.')
    }

    const conversa = await this.db.conversation.findUnique({ where: { id: conversationId } })
    if (!conversa) return err('ATENDIMENTO_NAO_ENCONTRADO', 'Este atendimento não existe.')
    if (!conversa.customerId) {
      return err('CLIENTE_NAO_IDENTIFICADO', 'Identifique o cliente para gerar uma sugestão.')
    }

    const cliente = await this.customers.findWithContext(conversa.customerId)
    if (!cliente) return err('CLIENTE_NAO_IDENTIFICADO', 'Cliente não encontrado.')

    const r = await this.offers.generate(cliente, conversationId)
    return r.success ? ok({ ok: true }) : r
  }

  async reply(id: string, agentId: string, text: string): Promise<Result<{ ok: true }>> {
    const c = await this.db.conversation.findUnique({ where: { id } })
    if (!c) return err('ATENDIMENTO_NAO_ENCONTRADO', 'Este atendimento não existe.')

    if (c.assignedAgentId !== agentId) {
      return err('ATENDIMENTO_DE_OUTRO', 'Assuma o atendimento antes de responder.')
    }

    await this.messages.append({
      conversationId: id,
      channel: c.currentChannel,
      direction: 'OUTBOUND',
      sender: 'AGENT',
      text,
    })

    await this.db.conversation.update({ where: { id }, data: { updatedAt: new Date() } })
    return ok({ ok: true })
  }

  async resolve(id: string): Promise<Result<{ ok: true }>> {
    const atualizados = await this.db.conversation.updateMany({
      where: { id, status: { not: 'RESOLVED' } },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    })

    if (atualizados.count === 0) {
      return err('ATENDIMENTO_JA_RESOLVIDO', 'Este atendimento já está resolvido.')
    }
    return ok({ ok: true })
  }

  async metrics(now = new Date()): Promise<Metrics> {
    const inicioDoDia = new Date(now)
    inicioDoDia.setHours(0, 0, 0, 0)

    const [conversas, resolvidasHoje] = await Promise.all([
      this.db.conversation.findMany({
        select: {
          status: true,
          intent: true,
          currentChannel: true,
          originChannel: true,
          updatedAt: true,
          assignedAgentId: true,
        },
      }),
      this.db.conversation.count({ where: { resolvedAt: { gte: inicioDoDia } } }),
    ])

    const esperando = conversas.filter((c) => c.status === 'WAITING_HUMAN')
    const comAtendente = conversas.filter((c) => c.status === 'WITH_HUMAN')

    // Resolvido só pela IA significa nunca ter passado por um atendente.
    const resolvidas = conversas.filter((c) => c.status === 'RESOLVED')
    const semHumano = resolvidas.filter((c) => !c.assignedAgentId)

    const porIntencao = new Map<Intent, number>()
    for (const c of esperando) {
      if (!c.intent) continue
      porIntencao.set(c.intent, (porIntencao.get(c.intent) ?? 0) + 1)
    }

    const porCanal = new Map<Channel, number>()
    for (const c of conversas) {
      porCanal.set(c.currentChannel, (porCanal.get(c.currentChannel) ?? 0) + 1)
    }

    const esperas = esperando.map((c) =>
      Math.max(0, Math.floor((now.getTime() - c.updatedAt.getTime()) / 1000)),
    )

    return {
      waiting: esperando.length,
      withAgent: comAtendente.length,
      withBot: conversas.filter((c) => c.status === 'BOT').length,
      resolvedToday: resolvidasHoje,
      botResolutionRate: resolvidas.length === 0 ? 0 : semHumano.length / resolvidas.length,
      worstWaitSeconds: esperas.length === 0 ? 0 : Math.max(...esperas),
      // O KPI que justifica o projeto: quantas conversas trocaram de canal.
      channelHandoffs: conversas.filter((c) => c.currentChannel !== c.originChannel).length,
      byIntent: [...porIntencao.entries()].map(([intent, waiting]) => ({ intent, waiting })),
      byChannel: [...porCanal.entries()].map(([channel, total]) => ({ channel, total })),
    }
  }
}
