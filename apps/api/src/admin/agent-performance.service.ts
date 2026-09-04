import type { Intent, Result } from '@sync/contracts'
import { err, ok } from '@sync/contracts'
import type { PrismaClient } from '@sync/db'
import type { AgentRole } from '../auth/roles.js'

export type AgentPerformance = {
  agentId: string
  name: string
  role: AgentRole
  /** Atendimentos abertos com esta pessoa agora. */
  handlingNow: number
  resolvedToday: number
  resolvedTotal: number
  /**
   * Tempo médio entre assumir e encerrar, em segundos.
   *
   * Mede o trabalho da pessoa, não a jornada do cliente. Usar a criação da
   * conversa aqui misturaria a espera na fila, que não é responsabilidade dela.
   * Fica nulo enquanto não houver atendimento encerrado com tempo medido.
   */
  avgHandlingSeconds: number | null
  byIntent: { intent: Intent; total: number }[]
}

export class AgentPerformanceService {
  constructor(private readonly db: PrismaClient) {}

  async forAgent(agentId: string, now = new Date()): Promise<Result<AgentPerformance>> {
    const atendente = await this.db.agent.findUnique({ where: { id: agentId } })
    if (!atendente) return err('ATENDENTE_NAO_ENCONTRADO', 'Atendente não encontrado.')

    return ok(await this.compute(atendente, now))
  }

  /** Só para quem tem permissão de ver a equipe. A rota é que verifica. */
  async forTeam(now = new Date()): Promise<AgentPerformance[]> {
    const equipe = await this.db.agent.findMany({ orderBy: { name: 'asc' } })
    const linhas = await Promise.all(equipe.map((a) => this.compute(a, now)))

    // Quem está com mais gente na mão primeiro: é a leitura que o gestor faz ao
    // abrir a tela, e ordenar por nome esconderia justamente isso.
    return linhas.sort((a, b) => b.handlingNow - a.handlingNow)
  }

  private async compute(
    atendente: { id: string; name: string; role: AgentRole },
    now: Date,
  ): Promise<AgentPerformance> {
    const inicioDoDia = new Date(now)
    inicioDoDia.setHours(0, 0, 0, 0)

    const [emAndamento, encerradasHoje, encerradas] = await Promise.all([
      this.db.conversation.count({
        where: { assignedAgentId: atendente.id, status: 'WITH_HUMAN' },
      }),
      this.db.conversation.count({
        where: { assignedAgentId: atendente.id, resolvedAt: { gte: inicioDoDia } },
      }),
      this.db.conversation.findMany({
        where: { assignedAgentId: atendente.id, status: 'RESOLVED' },
        select: { intent: true, claimedAt: true, resolvedAt: true },
      }),
    ])

    const duracoes = encerradas
      .filter((c) => c.claimedAt !== null && c.resolvedAt !== null)
      .map((c) => (c.resolvedAt as Date).getTime() - (c.claimedAt as Date).getTime())
      .filter((ms) => ms >= 0)

    const porIntencao = new Map<Intent, number>()
    for (const c of encerradas) {
      if (!c.intent) continue
      porIntencao.set(c.intent, (porIntencao.get(c.intent) ?? 0) + 1)
    }

    return {
      agentId: atendente.id,
      name: atendente.name,
      role: atendente.role,
      handlingNow: emAndamento,
      resolvedToday: encerradasHoje,
      resolvedTotal: encerradas.length,
      avgHandlingSeconds:
        duracoes.length === 0
          ? null
          : Math.round(duracoes.reduce((a, b) => a + b, 0) / duracoes.length / 1000),
      byIntent: [...porIntencao.entries()]
        .map(([intent, total]) => ({ intent, total }))
        .sort((a, b) => b.total - a.total),
    }
  }
}
