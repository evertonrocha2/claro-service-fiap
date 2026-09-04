import type { NextFunction, Request, RequestHandler, Response } from 'express'

export const AGENT_ROLES = ['AGENT', 'MANAGER'] as const
export type AgentRole = (typeof AGENT_ROLES)[number]

/**
 * O que cada papel pode fazer.
 *
 * Declarado como dado, não espalhado em `if (role === ...)` pelas rotas. Quando
 * aparecer um terceiro papel, supervisor por exemplo, muda esta tabela e nada
 * mais. Com a verificação espalhada, um lugar esquecido é um furo.
 */
export const PERMISSIONS = {
  /** Ver a fila e responder atendimentos. Todo mundo da equipe. */
  handleConversations: ['AGENT', 'MANAGER'],
  /** Ver os próprios números e o próprio histórico. Todo mundo. */
  viewOwnPerformance: ['AGENT', 'MANAGER'],
  /** Ver o desempenho da equipe e o histórico de qualquer atendente. */
  viewTeamPerformance: ['MANAGER'],
} as const satisfies Record<string, readonly AgentRole[]>

export type Permission = keyof typeof PERMISSIONS

export function can(role: AgentRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly AgentRole[]).includes(role)
}

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && (AGENT_ROLES as readonly string[]).includes(value)
}

/**
 * Exige uma permissão na rota.
 *
 * Depende de `req.agentRole`, que o `loadAgentRole` coloca ali. O papel vem do
 * banco a cada requisição, não do token: promover ou rebaixar alguém precisa
 * valer na hora, e um JWT de 15 minutos carregaria o papel antigo por até 15
 * minutos depois da mudança.
 */
export function requirePermission(permission: Permission): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.agentRole

    if (!role || !can(role, permission)) {
      res.status(403).json({
        error: {
          code: 'PERMISSAO_INSUFICIENTE',
          message: 'Seu perfil não tem acesso a esta área.',
        },
      })
      return
    }

    next()
  }
}
