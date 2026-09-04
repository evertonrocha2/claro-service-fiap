import { ok, type Result } from '@sync/contracts'
import type { IRefreshTokenRepository } from './refresh-token.repository.js'

export type LogoutInput = { refreshToken: string }

export class LogoutUseCase {
  constructor(private readonly refreshTokens: IRefreshTokenRepository) {}

  /**
   * Revoga a família inteira, não só o token apresentado: sair da conta deve
   * encerrar a sessão de verdade, inclusive tokens já rotacionados.
   *
   * Sempre devolve sucesso. Token desconhecido não é erro do ponto de vista de
   * quem está saindo, e responder diferente entregaria se o token existia.
   */
  async execute(input: LogoutInput): Promise<Result<{ ok: true }>> {
    const token = await this.refreshTokens.findAny(input.refreshToken)
    if (token) await this.refreshTokens.revokeFamily(token.familyId)
    return ok({ ok: true })
  }
}
