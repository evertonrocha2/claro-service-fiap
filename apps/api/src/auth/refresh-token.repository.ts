import type { PrismaClient, RefreshToken } from '@sync/db'
import { hashRefreshToken } from './tokens.js'

export type IssueInput = {
  token: string
  subjectId: string
  subjectKind: 'CUSTOMER' | 'AGENT'
  ttlSeconds: number
  /** Ausente abre uma família nova. Presente continua a família de um login existente. */
  familyId?: string
}

export interface IRefreshTokenRepository {
  issue(input: IssueInput): Promise<RefreshToken>
  /** Só tokens vivos: não usados, não revogados, não expirados. */
  findValid(token: string): Promise<RefreshToken | null>
  /** Qualquer token, inclusive usado ou revogado. É como se detecta reuso. */
  findAny(token: string): Promise<RefreshToken | null>
  markUsed(id: string): Promise<void>
  revokeFamily(familyId: string): Promise<void>
}

export class PrismaRefreshTokenRepository implements IRefreshTokenRepository {
  constructor(private readonly db: PrismaClient) {}

  async issue(input: IssueInput): Promise<RefreshToken> {
    const criado = await this.db.refreshToken.create({
      data: {
        tokenHash: hashRefreshToken(input.token),
        subjectId: input.subjectId,
        subjectKind: input.subjectKind,
        expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
        // Placeholder: uma família nova recebe o próprio id logo abaixo.
        familyId: input.familyId ?? 'pendente',
      },
    })

    if (input.familyId) return criado

    return this.db.refreshToken.update({
      where: { id: criado.id },
      data: { familyId: criado.id },
    })
  }

  findValid(token: string): Promise<RefreshToken | null> {
    return this.db.refreshToken.findFirst({
      where: {
        tokenHash: hashRefreshToken(token),
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    })
  }

  findAny(token: string): Promise<RefreshToken | null> {
    return this.db.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
    })
  }

  async markUsed(id: string): Promise<void> {
    await this.db.refreshToken.update({ where: { id }, data: { usedAt: new Date() } })
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }
}
