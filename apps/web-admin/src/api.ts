import type { Channel, ConversationStatus, Intent } from '@sync/contracts'

export type AgentSession = {
  accessToken: string
  refreshToken: string
  agent: { id: string; name: string; email: string; role: 'AGENT' | 'MANAGER' }
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
  createdAt: string
}

export const OFFER_LABELS: Record<string, string> = {
  RETENCAO: 'Retenção',
  UPGRADE: 'Upgrade',
  DESCONTO: 'Desconto',
  SUPORTE_TECNICO: 'Suporte técnico',
  NEGOCIACAO_FATURA: 'Negociação de fatura',
  NENHUMA: 'Sem oferta',
}

export type ConversationDetail = QueueItem & {
  assignedAgentId: string | null
  customerPhone: string | null
  offer: OfferSuggestion | null
  customerCpfMasked: string | null
  customerEmail: string | null
  messages: {
    id: string
    sender: 'CUSTOMER' | 'BOT' | 'AGENT'
    channel: Channel
    text: string
    at: string
  }[]
}

export type AgentRole = 'AGENT' | 'MANAGER'

export type Me = {
  id: string
  name: string
  email: string
  role: AgentRole
  canViewTeam: boolean
}

export type AgentPerformance = {
  agentId: string
  name: string
  role: AgentRole
  handlingNow: number
  resolvedToday: number
  resolvedTotal: number
  /** Nulo quando ainda nao houve atendimento encerrado com tempo medido. */
  avgHandlingSeconds: number | null
  byIntent: { intent: Intent; total: number }[]
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

export class ConsoleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Renovação sob demanda, registrada pelo hook de sessão.
 *
 * Quando uma chamada volta 401, o token é renovado e a chamada repetida uma vez.
 * Antes só existia a renovação por temporizador, e se ela perdesse a janela, por
 * suspensão da máquina ou aba em segundo plano, o console travava e dizia "sem
 * conexão com o servidor", que era falso.
 */
let renovar: (() => Promise<string | null>) | null = null

export function registrarRenovacao(fn: (() => Promise<string | null>) | null): void {
  renovar = fn
}

async function chamar(caminho: string, token: string | null, init: RequestInit): Promise<Response> {
  return fetch(caminho, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
}

async function pedir<T>(caminho: string, token: string | null, init: RequestInit = {}): Promise<T> {
  let resposta = await chamar(caminho, token, init)

  // Uma tentativa só. Se a renovação também falhar, a sessão acabou de verdade
  // e insistir viraria laço.
  if (resposta.status === 401 && token && renovar) {
    const novo = await renovar()
    if (novo) resposta = await chamar(caminho, novo, init)
  }

  const dados = await resposta.json().catch(() => null)

  if (!resposta.ok) {
    const erro = (dados as { error?: { code: string; message: string } } | null)?.error
    throw new ConsoleError(
      erro?.code ?? 'ERRO_DESCONHECIDO',
      erro?.message ?? 'Não foi possível concluir. Tente novamente.',
    )
  }

  return dados as T
}

export const api = {
  refresh: (refreshToken: string) =>
    pedir<{ accessToken: string; refreshToken: string }>('/api/auth/refresh', null, {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  login: (email: string, password: string) =>
    pedir<AgentSession>('/api/auth/agent/login', null, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  queue: (
    token: string,
    filtros: { status?: ConversationStatus; intent?: Intent; assignedTo?: string } = {},
  ) => {
    const busca = new URLSearchParams()
    if (filtros.status) busca.set('status', filtros.status)
    if (filtros.intent) busca.set('intent', filtros.intent)
    if (filtros.assignedTo) busca.set('assignedTo', filtros.assignedTo)
    const query = busca.size > 0 ? `?${busca}` : ''
    return pedir<QueueItem[]>(`/api/admin/conversations${query}`, token)
  },

  me: (token: string) => pedir<Me>('/api/admin/me', token),

  myPerformance: (token: string) => pedir<AgentPerformance>('/api/admin/performance/me', token),

  teamPerformance: (token: string) =>
    pedir<AgentPerformance[]>('/api/admin/performance/team', token),

  agentPerformance: (token: string, agentId: string) =>
    pedir<AgentPerformance>(`/api/admin/performance/${agentId}`, token),

  metrics: (token: string) => pedir<Metrics>('/api/admin/metrics', token),

  detail: (token: string, id: string) =>
    pedir<ConversationDetail>(`/api/admin/conversations/${id}`, token),

  claim: (token: string, id: string) =>
    pedir<{ ok: true }>(`/api/admin/conversations/${id}/claim`, token, { method: 'POST' }),

  reply: (token: string, id: string, text: string) =>
    pedir<{ ok: true }>(`/api/admin/conversations/${id}/messages`, token, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  refreshOffer: (token: string, id: string) =>
    pedir<{ ok: true }>(`/api/admin/conversations/${id}/offer`, token, { method: 'POST' }),

  resolve: (token: string, id: string) =>
    pedir<{ ok: true }>(`/api/admin/conversations/${id}/resolve`, token, { method: 'POST' }),
}

/**
 * Colunas ordenadas por custo de ignorar, não por volume nem alfabeto.
 *
 * Cancelamento é sempre a primeira: é um cliente indo embora. Depois quem pediu
 * humano explicitamente. Ordem de leitura vira ordem de triagem, e o gestor bate
 * o olho na esquerda para saber o que está pegando fogo.
 */
export const INTENT_COLUMNS: { intent: Intent; label: string; short: string }[] = [
  { intent: 'CANCELAMENTO', label: 'Cancelamento', short: 'Cancelamento' },
  { intent: 'FALAR_COM_ATENDENTE', label: 'Solicitou atendente', short: 'Solicitou atendente' },
  { intent: 'PROBLEMA_TECNICO', label: 'Problema técnico', short: 'Técnico' },
  { intent: 'FATURA_SEGUNDA_VIA', label: 'Fatura', short: 'Fatura' },
  { intent: 'CONSULTA_PLANO', label: 'Plano', short: 'Plano' },
  { intent: 'DESCONHECIDA', label: 'Não classificado', short: 'Não classificado' },
]

export const CHANNEL_LABELS: Record<Channel, string> = {
  SITE: 'Site',
  APP: 'App',
  WHATSAPP: 'WhatsApp',
}

export const STATUS_LABELS: Record<ConversationStatus, string> = {
  BOT: 'Atendimento automático',
  WAITING_HUMAN: 'Aguardando',
  WITH_HUMAN: 'Em atendimento',
  RESOLVED: 'Resolvido',
}

export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutos = Math.floor(seconds / 60)
  if (minutos < 60) return `${minutos}min`
  return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, '0')}`
}
