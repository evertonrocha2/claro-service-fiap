export const CHANNELS = ['SITE', 'APP', 'WHATSAPP'] as const
export type Channel = (typeof CHANNELS)[number]

export const INTENTS = [
  'FATURA_SEGUNDA_VIA',
  'PROBLEMA_TECNICO',
  'CONSULTA_PLANO',
  'CANCELAMENTO',
  'FALAR_COM_ATENDENTE',
  'DESCONHECIDA',
] as const
export type Intent = (typeof INTENTS)[number]

export const CONVERSATION_STATUSES = ['BOT', 'WAITING_HUMAN', 'WITH_HUMAN', 'RESOLVED'] as const
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number]

export const SENDERS = ['CUSTOMER', 'BOT', 'AGENT'] as const
export type Sender = (typeof SENDERS)[number]

export const DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const
export type Direction = (typeof DIRECTIONS)[number]
