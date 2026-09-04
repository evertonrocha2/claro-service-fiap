import { createHash, randomBytes } from 'node:crypto'
import { err, ok, type Result } from '@sync/contracts'
import { jwtVerify, SignJWT } from 'jose'

export const ACCESS_TTL_SECONDS = 15 * 60
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60

export type SubjectKind = 'CUSTOMER' | 'AGENT'

export type TokenSubject = {
  subjectId: string
  kind: SubjectKind
}

/**
 * O refresh token é opaco, não um JWT: precisa ser revogável no servidor, e um JWT
 * autocontido não seria. Guardamos só o hash, então vazar o banco não entrega
 * tokens utilizáveis.
 */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export class TokenService {
  private readonly chave: Uint8Array

  constructor(segredo: string) {
    if (segredo.length < 32) {
      throw new Error('JWT_SECRET precisa ter ao menos 32 caracteres')
    }
    this.chave = new TextEncoder().encode(segredo)
  }

  signAccess(sub: TokenSubject): Promise<string> {
    return new SignJWT({ kind: sub.kind })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub.subjectId)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(this.chave)
  }

  async verifyAccess(token: string): Promise<Result<TokenSubject>> {
    try {
      const { payload } = await jwtVerify(token, this.chave, { algorithms: ['HS256'] })
      const kind = payload.kind
      if (!payload.sub || (kind !== 'CUSTOMER' && kind !== 'AGENT')) {
        return err('TOKEN_INVALIDO', 'Token sem sujeito ou com tipo desconhecido.')
      }
      return ok({ subjectId: payload.sub, kind })
    } catch {
      return err('TOKEN_INVALIDO', 'Token inválido ou expirado.')
    }
  }
}
