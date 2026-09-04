import { CHANNELS, CONVERSATION_STATUSES, err, INTENTS, ok, type Result } from '@sync/contracts'
import { Router as makeRouter, type Request, type Response, type Router } from 'express'
import { z } from 'zod'
import type { IAgentRepository } from '../auth/agent.repository.js'
import { requireAuth } from '../auth/middleware.js'
import { can, isAgentRole, requirePermission } from '../auth/roles.js'
import type { TokenService } from '../auth/tokens.js'
import type { AdminService } from './admin.service.js'
import type { AgentPerformanceService } from './agent-performance.service.js'

export type AdminDeps = {
  service: AdminService
  performance: AgentPerformanceService
  agents: IAgentRepository
  tokens: TokenService
}

const filtrosSchema = z.object({
  status: z.enum(CONVERSATION_STATUSES).optional(),
  channel: z.enum(CHANNELS).optional(),
  intent: z.enum(INTENTS).optional(),
  /** "me" resolve para quem está pedindo. Um id exige permissão de equipe. */
  assignedTo: z.string().min(1).optional(),
})

const respostaSchema = z.object({ text: z.string().min(1).max(2000) })

const NAO_AUTORIZADO = new Set(['PERMISSAO_INSUFICIENTE', 'ACESSO_NEGADO'])

const NAO_ENCONTRADO = new Set(['ATENDIMENTO_NAO_ENCONTRADO', 'ATENDENTE_NAO_ENCONTRADO'])

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
  const status = NAO_ENCONTRADO.has(codigo)
    ? 404
    : NAO_AUTORIZADO.has(codigo)
      ? 403
      : CONFLITO.has(codigo)
        ? 409
        : 400

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

  /**
   * Carrega o papel do banco a cada requisição.
   *
   * Não vem do token de propósito: rebaixar alguém precisa valer na hora, e um
   * JWT de 15 minutos carregaria o papel antigo por todo esse tempo. Uma conta
   * removida também para de passar aqui imediatamente.
   */
  router.use(async (req: Request, res: Response, next) => {
    const atendente = await deps.agents.findById(req.auth?.subjectId ?? '')

    if (!atendente || !isAgentRole(atendente.role)) {
      res.status(403).json({
        error: { code: 'ACESSO_NEGADO', message: 'Conta de atendimento não encontrada.' },
      })
      return
    }

    req.agentRole = atendente.role
    next()
  })

  /**
   * Resolve o responsável pedido no filtro.
   *
   * "me" é sempre permitido. Pedir o id de outra pessoa exige permissão de
   * equipe, senão qualquer atendente leria a fila dos colegas apenas trocando um
   * parâmetro na URL.
   */
  function resolverResponsavel(req: Request, pedido?: string): Result<string | undefined> {
    if (!pedido) return ok(undefined)

    const eu = req.auth?.subjectId ?? ''
    if (pedido === 'me' || pedido === eu) return ok(eu)

    if (!req.agentRole || !can(req.agentRole, 'viewTeamPerformance')) {
      return err('PERMISSAO_INSUFICIENTE', 'Seu perfil só acessa os próprios atendimentos.')
    }
    return ok(pedido)
  }

  router.get('/conversations', async (req: Request, res: Response) => {
    const filtros = filtrosSchema.safeParse(req.query)
    if (!filtros.success) {
      responder(res, err('FILTRO_INVALIDO', 'Filtro não reconhecido.'))
      return
    }

    const { assignedTo, ...resto } = filtros.data
    const responsavel = resolverResponsavel(req, assignedTo)
    if (!responsavel.success) {
      responder(res, responsavel)
      return
    }

    res.json(
      await deps.service.queue({
        ...resto,
        ...(responsavel.data ? { assignedAgentId: responsavel.data } : {}),
      }),
    )
  })

  router.get('/metrics', async (_req: Request, res: Response) => {
    res.json(await deps.service.metrics())
  })

  /** Quem sou eu e o que meu perfil pode fazer. A interface monta o menu com isto. */
  router.get('/me', async (req: Request, res: Response) => {
    const atendente = await deps.agents.findById(req.auth?.subjectId ?? '')
    if (!atendente) {
      responder(res, err('ATENDENTE_NAO_ENCONTRADO', 'Atendente não encontrado.'))
      return
    }

    res.json({
      id: atendente.id,
      name: atendente.name,
      email: atendente.email,
      role: atendente.role,
      canViewTeam: isAgentRole(atendente.role) && can(atendente.role, 'viewTeamPerformance'),
    })
  })

  /** Os próprios números. Disponível para qualquer perfil da equipe. */
  router.get(
    '/performance/me',
    requirePermission('viewOwnPerformance'),
    async (req: Request, res: Response) => {
      responder(res, await deps.performance.forAgent(req.auth?.subjectId ?? ''))
    },
  )

  /** Desempenho da equipe inteira. Somente gestão. */
  router.get(
    '/performance/team',
    requirePermission('viewTeamPerformance'),
    async (_req: Request, res: Response) => {
      res.json(await deps.performance.forTeam())
    },
  )

  /** Números de um atendente. Os próprios sempre, de outro somente gestão. */
  router.get('/performance/:agentId', async (req: Request, res: Response) => {
    const alvo = resolverResponsavel(req, String(req.params.agentId))
    if (!alvo.success) {
      responder(res, alvo)
      return
    }
    responder(res, await deps.performance.forAgent(alvo.data ?? ''))
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

  router.post('/conversations/:id/offer', async (req: Request, res: Response) => {
    responder(res, await deps.service.refreshOffer(String(req.params.id)))
  })

  router.post('/conversations/:id/resolve', async (req: Request, res: Response) => {
    responder(res, await deps.service.resolve(String(req.params.id)))
  })

  return router
}
