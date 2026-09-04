import { err, type InboundMessage, ok, type Result } from '@sync/contracts'
import { z } from 'zod'
import { normalizePhone } from '../identity/phone.js'

export const whatsappPayloadSchema = z.object({
  text: z.string().min(1).max(2000),
  phone: z.string().min(8).max(24),
  /** Presente quando o mock já sabe em qual conversa está. */
  conversationId: z.string().optional(),
})

export type WhatsAppPayload = z.infer<typeof whatsappPayloadSchema>

/**
 * Camada Sync para o WhatsApp.
 *
 * Fica separada da porta web por um motivo de confiança, não de organização. No
 * site o telefone é digitado por quem está do outro lado e não prova nada. Aqui
 * ele vem do canal, que já validou o aparelho, e por isso pode identificar o
 * cliente.
 *
 * O driver mock reproduz essa entrada, então esta porta só existe enquanto
 * WHATSAPP_DRIVER=mock. Em modo meta a única entrada é o webhook assinado: se as
 * duas ficassem abertas, qualquer pessoa postaria aqui o telefone de outra e
 * teria de volta o nome, o serviço e a fatura dela, que é exatamente a falha que
 * já corrigimos uma vez no lado do site.
 */
export function normalizeWhatsAppPayload(
  body: unknown,
  now: Date = new Date(),
): Result<InboundMessage> {
  const parsed = whatsappPayloadSchema.safeParse(body)
  if (!parsed.success) {
    return err('PAYLOAD_INVALIDO', 'Mensagem inválida. Texto e telefone são obrigatórios.')
  }

  const telefone = normalizePhone(parsed.data.phone)
  if (!telefone.success) return telefone

  const mensagem: InboundMessage = {
    channel: 'WHATSAPP',
    text: parsed.data.text,
    phone: telefone.data,
    receivedAt: now,
  }
  if (parsed.data.conversationId) mensagem.conversationId = parsed.data.conversationId

  return ok(mensagem)
}
