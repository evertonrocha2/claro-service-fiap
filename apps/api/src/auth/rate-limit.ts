import type { NextFunction, Request, RequestHandler, Response } from 'express'

export type RateLimitOptions = {
  max: number
  windowMs: number
}

type Janela = { contagem: number; expiraEm: number }

/**
 * Rate limit em memória, por IP e por rota.
 *
 * Em memória é suficiente para o MVP, que roda em uma instância só. Se o Sync for
 * para mais de uma instância, isso vira Redis: cada processo passaria a contar
 * separado e o limite efetivo multiplicaria pelo número de instâncias.
 */
export function rateLimit({ max, windowMs }: RateLimitOptions): RequestHandler {
  const janelas = new Map<string, Janela>()

  return (req: Request, res: Response, next: NextFunction) => {
    const agora = Date.now()
    const chave = `${req.ip ?? 'desconhecido'}:${req.path}`

    const janela = janelas.get(chave)
    if (!janela || janela.expiraEm <= agora) {
      janelas.set(chave, { contagem: 1, expiraEm: agora + windowMs })
      next()
      return
    }

    if (janela.contagem >= max) {
      const segundos = Math.ceil((janela.expiraEm - agora) / 1000)
      res.setHeader('Retry-After', String(segundos))
      res.status(429).json({
        error: {
          code: 'MUITAS_TENTATIVAS',
          message: `Muitas tentativas. Tente novamente em ${segundos} segundos.`,
        },
      })
      return
    }

    janela.contagem += 1
    next()
  }
}
