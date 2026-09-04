import {
  type Channel,
  type InboundMessage,
  type Result,
  err,
  ok,
  webChannelPayloadSchema,
} from '@sync/contracts'

export type AuthContext = { customerId?: string }

const CANAIS_WEB: Channel[] = ['SITE', 'APP']

/**
 * Componente "Camada Sync - entrada normalizada" do diagrama de arquitetura.
 *
 * É o único lugar que conhece o formato bruto de cada canal. O adapter da Meta
 * entra aqui na Fase 5, com a própria função de normalização, sem mexer em mais
 * nada do fluxo.
 */
export function normalizeWebPayload(
  channel: Channel,
  body: unknown,
  auth: AuthContext,
  now: Date = new Date(),
): Result<InboundMessage> {
  if (!CANAIS_WEB.includes(channel)) {
    return err('CANAL_INVALIDO', 'Este canal não entra pela porta web.')
  }

  const parsed = webChannelPayloadSchema.safeParse(body)
  if (!parsed.success) {
    return err('PAYLOAD_INVALIDO', 'Mensagem inválida. O texto é obrigatório.')
  }

  const mensagem: InboundMessage = {
    channel,
    text: parsed.data.text,
    receivedAt: now,
  }
  if (parsed.data.conversationId) mensagem.conversationId = parsed.data.conversationId
  if (auth.customerId) mensagem.customerId = auth.customerId

  return ok(mensagem)
}
