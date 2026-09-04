import type { Channel, Intent } from '@sync/contracts'

export type ChatRole = 'CUSTOMER' | 'BOT' | 'AGENT'

export type ChatMessage = {
  id: string
  role: ChatRole
  text: string
  at: Date
}

/** O que o Sync sabe da jornada agora. Espelha o bloco `context` da API. */
export type JourneyContext = {
  identified: boolean
  customerName: string | null
  channel: Channel
  originChannel: Channel
  intent: Intent | null
  serviceLabel: string | null
}

export type ConversationState = {
  conversationId: string | null
  protocol: string | null
  status: 'BOT' | 'WAITING_HUMAN' | 'WITH_HUMAN' | 'RESOLVED' | null
  context: JourneyContext | null
}

export const INTENT_LABELS: Record<Intent, string> = {
  FATURA_SEGUNDA_VIA: 'Segunda via de fatura',
  PROBLEMA_TECNICO: 'Problema técnico',
  CONSULTA_PLANO: 'Consulta de plano',
  CANCELAMENTO: 'Cancelamento',
  FALAR_COM_ATENDENTE: 'Falar com atendente',
  DESCONHECIDA: 'Ainda identificando',
}

export const CHANNEL_LABELS: Record<Channel, string> = {
  SITE: 'Site',
  APP: 'App',
  WHATSAPP: 'WhatsApp',
}
