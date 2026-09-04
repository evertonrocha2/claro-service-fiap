import type { Channel, ConversationStatus, Intent, Result } from '@sync/contracts'
import { err, ok } from '@sync/contracts'
import type { PrismaClient } from '@sync/db'
import type { IMessageRepository } from '../context/index.js'

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

export type ConversationDetail = QueueItem & {
  customerCpfMasked: string | null
  customerEmail: string | null
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

const ATIVOS: ConversationStatus[] = ['BOT', 'WAITING_HUMAN', 'WITH_HUMAN']

export class AdminService {
  constructor(
    private readonly db: PrismaClient,
    private readonly messages: IMessageRepository,
  ) {}

  async queue(filters: QueueFilters, now = new Date()): Promise<QueueItem[]> {
    const conversas = await this.db.conversation.findMany({
      where: {
        status: filters.status ? filters.status : { in: ATIVOS },
        ...(filters.channel ? { currentChannel: filters.channel } : {}),
        ...(filters.intent ? { intent: filters.intent } : {}),
      },
      include: {
        customer: true,
        service: true,
        agent: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
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

    const mensagens = await this.messages.listByConversation(id)

    return ok({
      id: c.id,
      protocol: c.protocol,
      customerName: c.customer?.name ?? null,
      customerCpfMasked: c.customer ? maskCpf(c.customer.cpf) : null,
      customerEmail: c.customer?.email ?? null,
      channel: c.currentChannel,
      originChannel: c.originChannel,
      intent: c.intent,
      status: c.status,
      serviceLabel: c.service?.label ?? null,
      waitingSeconds: Math.max(0, Math.floor((now.getTime() - c.updatedAt.getTime()) / 1000)),
      lastMessage: mensagens.at(-1)?.text ?? null,
      assignedAgentName: c.agent?.name ?? null,
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
    return ok({ ok: true })
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
