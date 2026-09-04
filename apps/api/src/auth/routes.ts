import { err, type Result } from '@sync/contracts'
import { Router as makeRouter, type Request, type Response, type Router } from 'express'
import { z } from 'zod'
import type { FirstAccessUseCase } from './first-access.use-case.js'
import type { LoginUseCase } from './login.use-case.js'
import type { LogoutUseCase } from './logout.use-case.js'
import { requireAuth } from './middleware.js'
import type { PasswordResetUseCase } from './password-reset.use-case.js'
import { rateLimit } from './rate-limit.js'
import type { RefreshUseCase } from './refresh.use-case.js'
import type { TokenService } from './tokens.js'

export type AuthDeps = {
  firstAccess: FirstAccessUseCase
  login: LoginUseCase
  refresh: RefreshUseCase
  logout: LogoutUseCase
  passwordReset: PasswordResetUseCase
  tokens: TokenService
}

const firstAccessSchema = z.object({
  cpf: z.string().min(11).max(14),
  email: z.email(),
  password: z.string().min(1),
})

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

const resetRequestSchema = z.object({
  cpf: z.string().min(11).max(14),
  email: z.email(),
})

const resetConfirmSchema = z.object({
  code: z.string().min(4).max(32),
  password: z.string().min(1),
})

/** Códigos de erro que viram 401 em vez de 400. */
const NAO_AUTORIZADO = new Set(['CREDENCIAIS_INVALIDAS', 'REFRESH_INVALIDO', 'REFRESH_REUSADO'])

function responder<T>(res: Response, resultado: Result<T>): void {
  if (resultado.success) {
    res.json(resultado.data)
    return
  }
  res.status(NAO_AUTORIZADO.has(resultado.error.code) ? 401 : 400).json({ error: resultado.error })
}

export function createAuthRouter(deps: AuthDeps): Router {
  const router = makeRouter()

  // Limites apertados: estas rotas são o alvo natural de força bruta e de
  // enumeração de contas.
  const limiteTentativas = rateLimit({ max: 10, windowMs: 15 * 60_000 })

  router.post('/first-access', limiteTentativas, async (req: Request, res: Response) => {
    const parsed = firstAccessSchema.safeParse(req.body)
    if (!parsed.success) {
      responder(res, err('PAYLOAD_INVALIDO', 'Informe CPF, e-mail e senha.'))
      return
    }
    responder(res, await deps.firstAccess.execute(parsed.data))
  })

  router.post('/login', limiteTentativas, async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      responder(res, err('PAYLOAD_INVALIDO', 'Informe e-mail e senha.'))
      return
    }
    responder(res, await deps.login.execute(parsed.data))
  })

  router.post('/agent/login', limiteTentativas, async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      responder(res, err('PAYLOAD_INVALIDO', 'Informe e-mail e senha.'))
      return
    }
    responder(res, await deps.login.executeAgent(parsed.data))
  })

  /**
   * Pedido de recuperação. Responde igual exista ou não a conta.
   *
   * O limite de tentativas importa mais aqui do que no login: e o que impede
   * varrer CPFs e, do outro lado, chutar codigos de oito caracteres.
   */
  router.post('/password-reset', limiteTentativas, async (req: Request, res: Response) => {
    const parsed = resetRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      responder(res, err('PAYLOAD_INVALIDO', 'Informe CPF e e-mail.'))
      return
    }
    responder(res, await deps.passwordReset.request(parsed.data))
  })

  router.post('/password-reset/confirm', limiteTentativas, async (req: Request, res: Response) => {
    const parsed = resetConfirmSchema.safeParse(req.body)
    if (!parsed.success) {
      responder(res, err('PAYLOAD_INVALIDO', 'Informe o código e a nova senha.'))
      return
    }
    responder(res, await deps.passwordReset.confirm(parsed.data))
  })

  router.post('/refresh', async (req: Request, res: Response) => {
    const parsed = refreshSchema.safeParse(req.body)
    if (!parsed.success) {
      responder(res, err('PAYLOAD_INVALIDO', 'Informe o refresh token.'))
      return
    }
    responder(res, await deps.refresh.execute(parsed.data))
  })

  router.post('/logout', async (req: Request, res: Response) => {
    const parsed = refreshSchema.safeParse(req.body)
    if (!parsed.success) {
      responder(res, err('PAYLOAD_INVALIDO', 'Informe o refresh token.'))
      return
    }
    responder(res, await deps.logout.execute(parsed.data))
  })

  router.get('/me', requireAuth(deps.tokens), (req: Request, res: Response) => {
    res.json({ subjectId: req.auth?.subjectId, kind: req.auth?.kind })
  })

  return router
}
