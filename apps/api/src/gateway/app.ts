import { CHANNELS, type Channel } from '@sync/contracts'
import express, { type Express, type Request, type Response } from 'express'
import { z } from 'zod'
import { createAdminRouter } from '../admin/routes.js'
import { optionalAuth } from '../auth/middleware.js'
import { createAuthRouter } from '../auth/routes.js'
import { normalizeWebPayload } from '../channels/normalizer.js'
import type { Container } from './container.js'

const contatoSchema = z.object({ phone: z.string().min(8).max(24) })

function parseChannel(raw: string): Channel | null {
  const upper = raw.toUpperCase()
  return (CHANNELS as readonly string[]).includes(upper) ? (upper as Channel) : null
}

export function createApp(deps: Container): Express {
  const app = express()
  app.use(express.json())

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' })
  })

  app.use('/api/auth', createAuthRouter(deps.auth))
  app.use('/api/admin', createAdminRouter(deps.admin))

  app.get(
    '/api/conversations/:id',
    optionalAuth(deps.auth.tokens),
    async (req: Request, res: Response) => {
      const dono = req.auth?.kind === 'CUSTOMER' ? req.auth.subjectId : undefined
      const r = await deps.readConversation.execute(String(req.params.id), dono)

      if (!r.success) {
        const status = r.error.code === 'CONVERSA_NAO_ENCONTRADA' ? 404 : 403
        res.status(status).json({ error: r.error })
        return
      }
      res.json(r.data)
    },
  )

  app.post(
    '/api/conversations/:id/contact',
    optionalAuth(deps.auth.tokens),
    async (req: Request, res: Response) => {
      const corpo = contatoSchema.safeParse(req.body)
      if (!corpo.success) {
        res
          .status(400)
          .json({ error: { code: 'PAYLOAD_INVALIDO', message: 'Informe o telefone.' } })
        return
      }

      const dono = req.auth?.kind === 'CUSTOMER' ? req.auth.subjectId : undefined
      const r = await deps.setContact.execute(String(req.params.id), corpo.data.phone, dono)

      if (!r.success) {
        const status =
          r.error.code === 'CONVERSA_NAO_ENCONTRADA'
            ? 404
            : r.error.code === 'CONVERSA_DE_OUTRO_CLIENTE'
              ? 403
              : 400
        res.status(status).json({ error: r.error })
        return
      }
      res.json(r.data)
    },
  )

  app.post(
    '/api/channels/:channel/messages',
    optionalAuth(deps.auth.tokens),
    async (req: Request, res: Response) => {
      const bruto = req.params.channel
      const channel = parseChannel(Array.isArray(bruto) ? (bruto[0] ?? '') : (bruto ?? ''))
      if (!channel) {
        res
          .status(400)
          .json({ error: { code: 'CANAL_INVALIDO', message: 'Canal não reconhecido.' } })
        return
      }

      // O customerId sai do token, nunca do corpo da requisicao: aceitar do corpo
      // deixaria qualquer um conversar como se fosse outro cliente.
      const auth = req.auth?.kind === 'CUSTOMER' ? { customerId: req.auth.subjectId } : {}
      const normalizado = normalizeWebPayload(channel, req.body, auth)
      if (!normalizado.success) {
        res.status(400).json({ error: normalizado.error })
        return
      }

      try {
        const resultado = await deps.orchestrator.handle(normalizado.data)
        if (!resultado.success) {
          res.status(500).json({ error: resultado.error })
          return
        }
        res.json(resultado.data)
      } catch {
        res.status(500).json({
          error: { code: 'ERRO_INTERNO', message: 'Não foi possível processar a mensagem.' },
        })
      }
    },
  )

  return app
}
