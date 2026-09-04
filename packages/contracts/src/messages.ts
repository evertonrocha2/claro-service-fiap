import { z } from 'zod'
import { CHANNELS } from './enums.js'

export const webChannelPayloadSchema = z.object({
  text: z.string().min(1).max(2000),
  conversationId: z.string().optional(),
})

export type WebChannelPayload = z.infer<typeof webChannelPayloadSchema>

export const inboundMessageSchema = z.object({
  channel: z.enum(CHANNELS),
  text: z.string().min(1).max(2000),
  receivedAt: z.date(),
  customerId: z.string().optional(),
  phone: z.string().optional(),
  conversationId: z.string().optional(),
  externalId: z.string().optional(),
})

export type InboundMessage = z.infer<typeof inboundMessageSchema>
