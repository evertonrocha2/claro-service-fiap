import type { Channel, ConversationStatus, Intent, Result } from '@sync/contracts'
import { err, ok } from '@sync/contracts'
import type { PrismaClient } from '@sync/db'
import type { ICustomerRepository, IMessageRepository } from '../context/index.js'
import { extractHandoffCode } from '../conversation/handoff.use-case.js'
import type { OfferInsightService } from '../insights/offer-insight.service.js'

export type QueueFilters = {
  status?: ConversationStatus
  channel?: Channel
  intent?: Intent
  /** Responsavel. Quem nao e gestor so consegue pedir o proprio id. */
  assignedAgentId?: string
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
  /** Titulo escrito pela IA. Nulo quando ela nao estava disponivel. */
  cardSummary: string | null
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

/**
 * O que aparece no quadro.
 *
 * BOT entrou aqui depois. A regra do produto e que o atendente pode assumir
 * quando quiser, e a IA cala a boca a partir dai. Isso era impossivel: conversa
 * com a assistente nao aparecia em lugar nenhum do console, so como um numero
 * na faixa de indicadores, e o `claim` recusava. Nao da para assumir o que nao
 * se ve.
 *
 * O cartao do BOT sai marcado no quadro, para a fila nao perder o sentido de
 * "quem esta esperando uma pessoa".
 */
const PRECISAM_DE_GENTE: ConversationStatus[] = ['BOT', 'WAITING_HUMAN', 'WITH_HUMAN']

/**
 * A ultima coisa que o cliente pediu, ignorando o codigo de continuidade.
 *
 * O texto do handoff e controle: e o que o link preenche para amarrar as duas
 * conversas. Como titulo do cartao ele nao diz nada sobre o problema, e depois
 * de uma migracao de canal era o que aparecia em todos.
 */
function ultimoPedido(mensagens: { text: string }[]): string | null {
  const pedido = mensagens.find((m) => extractHandoffCode(m.text) === null)
  return pedido?.text ?? mensagens[0]?.text ?? null
}

/** Quem ainda nao tem dono. O atendente pode entrar nos dois. */
const SEM_DONO: ConversationStatus[] = ['BOT', 'WAITING_HUMAN']

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
        ...(filters.assignedAgentId ? { assignedAgentId: filters.assignedAgentId } : {}),
      },
      include: {
        customer: true,
        service: true,
        agent: true,
        // Só mensagem do cliente: o card precisa mostrar o problema, não a
        // última fala do bot, que é sempre a mesma frase de escalonamento.
        //
        // Três, e não uma: a última pode ser o código de continuidade, que é
        // controle e não pedido. Depois de um handoff, todo card do quadro
        // passava a se chamar "Continuar atendimento SYNC-…".
        messages: {
          where: { sender: 'CUSTOMER' },
          orderBy: { createdAt: 'desc' },
          take: 3,
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
      lastMessage: ultimoPedido(c.messages),
      // Campo separado, e nao substituto: a busca do console continua casando
      // com o texto que o cliente realmente escreveu.
      cardSummary: c.cardSummary,
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
      cardSummary: c.cardSummary,
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
  /**
   * O atendente entra na conversa, e a IA para de responder a partir daqui.
   *
   * Aceita BOT, e nao so WAITING_HUMAN. Antes, tentar assumir uma conversa que a
   * assistente ainda conduzia devolvia "outro atendente assumiu este
   * atendimento", que alem de recusar mentia sobre o motivo: ninguem tinha
   * assumido, o status e que nao era o esperado.
   *
   * O silencio em si nao mora aqui: o orquestrador ja se cala em WITH_HUMAN, nos
   * dois canais. O que faltava era conseguir chegar nesse status.
   */
  async claim(id: string, agentId: string): Promise<Result<{ ok: true }>> {
    const antes = await this.db.conversation.findUnique({ where: { id } })
    if (!antes) return err('ATENDIMENTO_NAO_ENCONTRADO', 'Este atendimento nao existe.')

    const atualizados = await this.db.conversation.updateMany({
      where: { id, status: { in: SEM_DONO } },
      // claimedAt e o inicio do trabalho humano. Sem ele o tempo de atendimento
      // sairia contaminado pela espera na fila, que nao e do atendente.
      data: { status: 'WITH_HUMAN', assignedAgentId: agentId, claimedAt: new Date() },
    })

    if (atualizados.count === 0) {
      return antes.status === 'RESOLVED'
        ? err('ATENDIMENTO_ENCERRADO', 'Este atendimento ja foi encerrado.')
        : err('ATENDIMENTO_JA_ASSUMIDO', 'Outro atendente assumiu este atendimento.')
    }

    // Avisa quem esta do outro lado, e so quando a assistente estava conduzindo.
    // Em WAITING_HUMAN o bot ja disse que ia transferir; aqui a pessoa estava no
    // meio de um dialogo com a IA e veria a IA emudecer sem explicacao.
    if (antes.status === 'BOT') {
      const atendente = await this.db.agent.findUnique({ where: { id: agentId } })
      const nome = atendente?.name.split(' ')[0] ?? 'Um atendente'

      await this.messages.append({
        conversationId: id,
        channel: antes.currentChannel,
        direction: 'OUTBOUND',
        sender: 'BOT',
        text: `${nome}, da equipe da Claro, entrou na conversa e segue com voce a partir daqui.`,
      })
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
