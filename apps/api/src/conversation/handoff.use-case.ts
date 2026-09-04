import { randomInt } from 'node:crypto'
import { err, ok, type Result } from '@sync/contracts'
import type { PrismaClient } from '@sync/db'
import type { IConversationRepository } from '../context/index.js'
import { assertPodeAcessar, type Requester } from './access.js'

/** Quinze minutos. O link serve para atravessar de um canal ao outro, não para guardar. */
export const HANDOFF_TTL_MS = 15 * 60 * 1000

/**
 * Alfabeto sem os caracteres que se confundem lidos em voz alta: sem O e 0, sem
 * I, 1 e L. Custa nada e ajuda se alguem precisar ditar o codigo no telefone.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * Comprimento do codigo: 16 caracteres, cerca de 79 bits.
 *
 * A primeira versao usava 4, alegando que o cliente digitaria o codigo. Ele
 * nunca digita: o codigo chega pre-preenchido no link e a pessoa so aperta
 * enviar. Era uma restricao inventada, e ela custava caro.
 *
 * Com 4 caracteres o espaco tinha 19,8 bits, e este codigo e uma credencial:
 * quem acerta um entra na conversa de outra pessoa, le o nome, o servico e a
 * fatura, e escreve como se fosse ela. A 1000 requisicoes por segundo, dentro
 * dos 15 minutos de validade, a chance de acertar um codigo vivo passava de 60%.
 */
const CODE_LEN = 16

const CODE_RE = new RegExp(String.raw`\bSYNC-[${ALFABETO}]{${CODE_LEN}}\b`, 'i')

export function generateHandoffCode(): string {
  let sufixo = ''
  // randomInt em vez de randomBytes com modulo: 256 % 31 = 8, entao os oito
  // primeiros caracteres do alfabeto sairiam mais que os outros.
  for (let i = 0; i < CODE_LEN; i++) sufixo += ALFABETO[randomInt(0, ALFABETO.length)]
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
 * Acesso: mesma regra da leitura, em access.ts. Cliente autenticado gera link só
 * da conversa dele. Sessão anônima gera com o id, porque exigir token do dono
 * impedia justamente o Cenário 1: quem conversa anônimo, informa o CPF e depois
 * quer continuar no WhatsApp passava a ser dono e perdia o direito ao próprio link.
 */
export class HandoffUseCase {
  constructor(
    private readonly db: PrismaClient,
    private readonly conversations: IConversationRepository,
    private readonly config: HandoffConfig,
  ) {}

  async create(conversationId: string, requester?: Requester): Promise<Result<HandoffLink>> {
    const conversa = await this.conversations.findById(conversationId)
    if (!conversa) {
      return err('CONVERSA_NAO_ENCONTRADA', 'Não encontramos este atendimento.')
    }

    const permitido = assertPodeAcessar(conversa.customerId, requester)
    if (!permitido.success) return permitido

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
