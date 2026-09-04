import { CHANNELS, type Channel } from '@sync/contracts'
import express, { type Express, type Request, type Response } from 'express'
import { normalizeWebPayload } from '../channels/normalizer.js'
import type { Container } from './container.js'

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

  app.post('/api/channels/:channel/messages', async (req: Request, res: Response) => {
    const bruto = req.params.channel
    const channel = parseChannel(Array.isArray(bruto) ? (bruto[0] ?? '') : (bruto ?? ''))
    if (!channel) {
      res.status(400).json({ error: { code: 'CANAL_INVALIDO', message: 'Canal não reconhecido.' } })
      return
    }

    const normalizado = normalizeWebPayload(channel, req.body, {})
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
  })

  return app
}
