import { CHANNELS, type Channel } from '@sync/contracts'
import express, { type Express, type Request, type Response } from 'express'
import { z } from 'zod'
import { createAdminRouter } from '../admin/routes.js'
import { optionalAuth } from '../auth/middleware.js'
import { rateLimit } from '../auth/rate-limit.js'
import { createAuthRouter } from '../auth/routes.js'
import { normalizeWebPayload } from '../channels/normalizer.js'
import { normalizeWhatsAppPayload } from '../channels/whatsapp-normalizer.js'
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
      const r = await deps.readConversation.execute(String(req.params.id))

      if (!r.success) {
        res.status(404).json({ error: r.error })
        return
      }
      res.json(r.data)
    },
  )

  /**
   * Porta do WhatsApp para o driver mock.
   *
   * Fora do modo mock ela nao existe. Em modo meta a unica entrada e o webhook
   * assinado: manter as duas abertas permitiria postar aqui o telefone de outra
   * pessoa e receber de volta o nome, o servico e a fatura dela.
   */
  /**
   * Limite generoso para conversa humana, inutil para forca bruta.
   *
   * E aqui que um codigo de handoff seria adivinhado por tentativa. Com 79 bits
   * o espaco ja e inalcancavel, mas a porta e publica e nao deveria aceitar
   * milhares de tentativas por minuto de qualquer forma.
   */
  const limiteDoCanal = rateLimit({ max: 30, windowMs: 60_000 })

  app.post(
    '/api/channels/whatsapp/messages',
    limiteDoCanal,
    async (req: Request, res: Response) => {
      if (deps.whatsappDriver !== 'mock') {
        res.status(404).json({
          error: {
            code: 'CANAL_INDISPONIVEL',
            message: 'Em produção o WhatsApp entra apenas pelo webhook da Meta.',
          },
        })
        return
      }

      const normalizado = normalizeWhatsAppPayload(req.body)
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

  app.post(
    '/api/conversations/:id/handoff',
    optionalAuth(deps.auth.tokens),
    async (req: Request, res: Response) => {
      const r = await deps.handoff.create(String(req.params.id))

      if (!r.success) {
        res.status(r.error.code === 'CONVERSA_NAO_ENCONTRADA' ? 404 : 400).json({ error: r.error })
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

      const r = await deps.setContact.execute(String(req.params.id), corpo.data.phone)

      if (!r.success) {
        res.status(r.error.code === 'CONVERSA_NAO_ENCONTRADA' ? 404 : 400).json({ error: r.error })
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
