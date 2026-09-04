import { formatWait } from '../api.js'
import type { AgentPerformance } from '../api.js'

/**
 * Quadro da equipe, só para gestão.
 *
 * Ordenado por quem está com mais gente na mão, que é a leitura de quem abre a
 * tela. Ordenar por nome esconderia justamente a sobrecarga.
 */
export function Team({
  team,
  selectedId,
  onSelect,
}: {
  team: AgentPerformance[]
  selectedId: string | null
  onSelect: (agentId: string) => void
}) {
  if (team.length === 0) {
    return (
      <div className="perf">
        <p className="history__empty">Carregando a equipe.</p>
      </div>
    )
  }

  return (
    <div className="history">
      <div className="team__head" aria-hidden="true">
        <span>Atendente</span>
        <span>Perfil</span>
        <span>Em atendimento</span>
        <span>Encerrados hoje</span>
        <span>Total</span>
        <span>Tempo médio</span>
      </div>

      {team.map((a) => (
        <button
          key={a.agentId}
          type="button"
          className="team__row"
          aria-current={a.agentId === selectedId}
          onClick={() => onSelect(a.agentId)}
        >
          <span className="history__cell history__cell--strong">{a.name}</span>
          <span className="history__cell">
            <span className={`pill ${a.role === 'MANAGER' ? 'pill--with-human' : ''}`}>
              {a.role === 'MANAGER' ? 'Gestão' : 'Atendimento'}
            </span>
          </span>
          <span className={`history__cell mono ${a.handlingNow > 0 ? 'team__busy' : ''}`}>
            {a.handlingNow}
          </span>
          <span className="history__cell mono">{a.resolvedToday}</span>
          <span className="history__cell mono">{a.resolvedTotal}</span>
          <span className="history__cell mono">
            {a.avgHandlingSeconds === null ? '—' : formatWait(a.avgHandlingSeconds)}
          </span>
        </button>
      ))}
    </div>
  )
}
