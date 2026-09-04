import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { TokenService, TokenSubject } from './tokens.js'

declare global {
  namespace Express {
    interface Request {
      auth?: TokenSubject
      /**
       * Papel do atendente, carregado do banco a cada requisicao.
       *
       * Nao vem do token de proposito: promover ou rebaixar alguem precisa valer
       * na hora, e um JWT de 15 minutos carregaria o papel antigo esse tempo todo.
       */
      agentRole?: 'AGENT' | 'MANAGER'
    }
  }
}

function extrairBearer(req: Request): string | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

/**
 * Popula `req.auth` quando há token válido e segue adiante de qualquer jeito.
 *
 * É o que o chat do site usa: conversa anônima continua permitida, e o RF002
 * resolve a identificação por CPF no diálogo. Token inválido é tratado como
 * ausente, não como erro.
 */
export function optionalAuth(tokens: TokenService): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = extrairBearer(req)
    if (token) {
      const r = await tokens.verifyAccess(token)
      if (r.success) req.auth = r.data
    }
    next()
  }
}

/** Exige token válido. É o que protege a área administrativa. */
export function requireAuth(tokens: TokenService): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = extrairBearer(req)
    const r = token ? await tokens.verifyAccess(token) : null

    if (!r?.success) {
      res
        .status(401)
        .json({ error: { code: 'NAO_AUTENTICADO', message: 'Faça login para continuar.' } })
      return
    }

    req.auth = r.data
    next()
  }
}
