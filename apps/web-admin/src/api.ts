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

async function pedir<T>(caminho: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const resposta = await fetch(caminho, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })

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

  queue: (token: string, filtros: { status?: ConversationStatus; intent?: Intent } = {}) => {
    const busca = new URLSearchParams()
    if (filtros.status) busca.set('status', filtros.status)
    if (filtros.intent) busca.set('intent', filtros.intent)
    const query = busca.size > 0 ? `?${busca}` : ''
    return pedir<QueueItem[]>(`/api/admin/conversations${query}`, token)
  },

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

/**
 * Grau de urgência pela espera, de 0 a 1. Alimenta a barra na borda do card.
 * Satura em 10 minutos: além disso a diferença já não muda o que o atendente faz.
 */
export function waitHeat(seconds: number): number {
  return Math.min(seconds / 600, 1)
}
