import { randomBytes } from 'node:crypto'
import { err, ok, type Result } from '@sync/contracts'
import type { PrismaClient } from '@sync/db'
import type { IConversationRepository } from '../context/index.js'

/** Quinze minutos. O link serve para atravessar de um canal ao outro, não para guardar. */
export const HANDOFF_TTL_MS = 15 * 60 * 1000

const CODE_RE = /\bSYNC-[A-Z0-9]{4}\b/i

/**
 * Alfabeto sem os caracteres que se confundem lidos em voz alta ou digitados de
 * um aparelho para outro: sem O e 0, sem I, 1 e L.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateHandoffCode(): string {
  const bytes = randomBytes(4)
  let sufixo = ''
  for (const b of bytes) sufixo += ALFABETO[b % ALFABETO.length]
  return `SYNC-${sufixo}`
}

export function extractHandoffCode(text: string): string | null {
  const achado = CODE_RE.exec(text)
  return achado ? achado[0].toUpperCase() : null
}

export type HandoffLink = {
  code: string
  /** Endereço que o cliente abre para continuar no outro canal. */
  url: string
  expiresAt: Date
}

export type HandoffConfig = {
  /** mock abre a tela local; meta abre o WhatsApp de verdade. */
  driver: 'mock' | 'meta'
  /** Número da Claro no WhatsApp, só dígitos. Usado no link wa.me. */
  fromNumber?: string
  /** Endereço da tela mock. */
  mockUrl?: string
}

/**
 * Gera o link de continuidade para o WhatsApp.
 *
 * O código vai dentro da mensagem que o cliente envia, e é ele que amarra a
 * conversa nova à antiga. Sem o código sobraria só o telefone, que o cliente
 * anônimo pode nunca ter informado.
 *
 * O link muda com o driver, e o resto do sistema não sabe a diferença: em mock
 * abre a tela local, em meta abre o aplicativo com a mensagem pré-preenchida.
 *
 * Acesso: possuir o id da conversa basta, a mesma regra da leitura. Exigir token
 * do dono impedia justamente o caso previsto no Cenário 1: quem conversa anônimo,
 * informa o CPF e depois quer continuar no WhatsApp passava a ser dono da
 * conversa e perdia o direito de gerar o próprio link.
 */
export class HandoffUseCase {
  constructor(
    private readonly db: PrismaClient,
    private readonly conversations: IConversationRepository,
    private readonly config: HandoffConfig,
  ) {}

  async create(conversationId: string): Promise<Result<HandoffLink>> {
    const conversa = await this.conversations.findById(conversationId)
    if (!conversa) {
      return err('CONVERSA_NAO_ENCONTRADA', 'Não encontramos este atendimento.')
    }

    const code = generateHandoffCode()
    const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS)

    await this.db.handoffToken.create({
      data: { code, conversationId, targetChannel: 'WHATSAPP', expiresAt },
    })

    const texto = `Continuar atendimento ${code}`

    const url =
      this.config.driver === 'meta' && this.config.fromNumber
        ? `https://wa.me/${this.config.fromNumber}?text=${encodeURIComponent(texto)}`
        : `${this.config.mockUrl ?? 'http://localhost:5175'}?text=${encodeURIComponent(texto)}`

    return ok({ code, url, expiresAt })
  }

  /**
   * Consome o código que veio na mensagem e devolve a conversa de origem.
   *
   * Um só uso: o código é marcado como usado na mesma consulta que o encontra.
   * Deixar reutilizável permitiria que alguém com o texto da mensagem entrasse
   * numa conversa que não é dele.
   */
  async consume(text: string): Promise<string | null> {
    const code = extractHandoffCode(text)
    if (!code) return null

    const atualizados = await this.db.handoffToken.updateMany({
      where: { code, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    })

    if (atualizados.count === 0) return null

    const token = await this.db.handoffToken.findUnique({ where: { code } })
    return token?.conversationId ?? null
  }
}
