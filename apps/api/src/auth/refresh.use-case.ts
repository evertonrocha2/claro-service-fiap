import { type Result, err, ok } from '@sync/contracts'
import type { IRefreshTokenRepository } from './refresh-token.repository.js'
import { REFRESH_TTL_SECONDS, type TokenService, newRefreshToken } from './tokens.js'

export type RefreshInput = { refreshToken: string }

export type RefreshOutput = {
  accessToken: string
  refreshToken: string
}

export class RefreshUseCase {
  constructor(
    private readonly refreshTokens: IRefreshTokenRepository,
    private readonly tokens: TokenService,
  ) {}

  async execute(input: RefreshInput): Promise<Result<RefreshOutput>> {
    const valido = await this.refreshTokens.findValid(input.refreshToken)

    if (!valido) {
      // O token não vale. Se ele existe mas já foi usado, é reuso: alguém guardou
      // um refresh antigo e está tentando de novo. Não dá para saber se é o
      // atacante ou a vítima, então a família inteira cai.
      const qualquer = await this.refreshTokens.findAny(input.refreshToken)
      if (qualquer?.usedAt) {
        await this.refreshTokens.revokeFamily(qualquer.familyId)
        return err('REFRESH_REUSADO', 'Sessão encerrada por segurança. Faça login novamente.')
      }
      return err('REFRESH_INVALIDO', 'Sessão expirada. Faça login novamente.')
    }

    await this.refreshTokens.markUsed(valido.id)

    const novoRefresh = newRefreshToken()
    await this.refreshTokens.issue({
      token: novoRefresh,
      subjectId: valido.subjectId,
      subjectKind: valido.subjectKind,
      familyId: valido.familyId,
      ttlSeconds: REFRESH_TTL_SECONDS,
    })

    return ok({
      accessToken: await this.tokens.signAccess({
        subjectId: valido.subjectId,
        kind: valido.subjectKind,
      }),
      refreshToken: novoRefresh,
    })
  }
}
