import { CHANNELS, CONVERSATION_STATUSES, err, INTENTS, type Result } from '@sync/contracts'
import { Router as makeRouter, type Request, type Response, type Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware.js'
import type { TokenService } from '../auth/tokens.js'
import type { AdminService } from './admin.service.js'

export type AdminDeps = {
  service: AdminService
  tokens: TokenService
}

const filtrosSchema = z.object({
  status: z.enum(CONVERSATION_STATUSES).optional(),
  channel: z.enum(CHANNELS).optional(),
  intent: z.enum(INTENTS).optional(),
})

const respostaSchema = z.object({ text: z.string().min(1).max(2000) })

const CONFLITO = new Set([
  'ATENDIMENTO_JA_ASSUMIDO',
  'ATENDIMENTO_JA_RESOLVIDO',
  'ATENDIMENTO_DE_OUTRO',
])

function responder<T>(res: Response, resultado: Result<T>): void {
  if (resultado.success) {
    res.json(resultado.data)
    return
  }
  const codigo = resultado.error.code
  const status = codigo === 'ATENDIMENTO_NAO_ENCONTRADO' ? 404 : CONFLITO.has(codigo) ? 409 : 400
  res.status(status).json({ error: resultado.error })
}

export function createAdminRouter(deps: AdminDeps): Router {
  const router = makeRouter()

  // Toda a área interna exige token. Um atendente autenticado vê dados de
  // clientes, então não existe rota aberta aqui.
  router.use(requireAuth(deps.tokens))

  router.use((req: Request, res: Response, next) => {
    if (req.auth?.kind !== 'AGENT') {
      res.status(403).json({
        error: { code: 'ACESSO_NEGADO', message: 'Esta área é da equipe de atendimento.' },
      })
      return
    }
    next()
  })

  router.get('/conversations', async (req: Request, res: Response) => {
    const filtros = filtrosSchema.safeParse(req.query)
    if (!filtros.success) {
      responder(res, err('FILTRO_INVALIDO', 'Filtro não reconhecido.'))
      return
    }
    res.json(await deps.service.queue(filtros.data))
  })

  router.get('/metrics', async (_req: Request, res: Response) => {
    res.json(await deps.service.metrics())
  })

  router.get('/conversations/:id', async (req: Request, res: Response) => {
    responder(res, await deps.service.detail(String(req.params.id)))
  })

  router.post('/conversations/:id/claim', async (req: Request, res: Response) => {
    const agentId = req.auth?.subjectId ?? ''
    responder(res, await deps.service.claim(String(req.params.id), agentId))
  })

  router.post('/conversations/:id/messages', async (req: Request, res: Response) => {
    const corpo = respostaSchema.safeParse(req.body)
    if (!corpo.success) {
      responder(res, err('PAYLOAD_INVALIDO', 'Escreva a mensagem antes de enviar.'))
      return
    }
    const agentId = req.auth?.subjectId ?? ''
    responder(res, await deps.service.reply(String(req.params.id), agentId, corpo.data.text))
  })

  router.post('/conversations/:id/resolve', async (req: Request, res: Response) => {
    responder(res, await deps.service.resolve(String(req.params.id)))
  })

  return router
}
