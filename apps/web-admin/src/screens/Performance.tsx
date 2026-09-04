import { Award, CheckCircle2, Headset, Timer, TrendingUp } from 'lucide-react'
import type { ComponentType } from 'react'
import { type AgentPerformance, formatWait, INTENT_COLUMNS } from '../api.js'

function intentLabel(intent: AgentPerformance['byIntent'][number]['intent']): string {
  return INTENT_COLUMNS.find((c) => c.intent === intent)?.label ?? intent
}

type Cartao = {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  label: string
  value: string
  hint?: string
}

function cartoes(p: AgentPerformance): Cartao[] {
  return [
    {
      icon: Headset,
      label: 'Em atendimento agora',
      value: String(p.handlingNow),
      hint: 'Conversas abertas com você',
    },
    {
      icon: CheckCircle2,
      label: 'Encerrados hoje',
      value: String(p.resolvedToday),
    },
    {
      icon: TrendingUp,
      label: 'Encerrados no total',
      value: String(p.resolvedTotal),
    },
    {
      icon: Timer,
      label: 'Tempo médio de atendimento',
      // Nulo e zero dizem coisas diferentes. Zero afirmaria resolução
      // instantânea; o traço diz que ainda não há medida.
      value: p.avgHandlingSeconds === null ? '—' : formatWait(p.avgHandlingSeconds),
      hint: 'Do momento em que você assume até encerrar',
    },
  ]
}

/**
 * Painel pessoal do atendente.
 *
 * Mede o trabalho da pessoa, não a jornada do cliente: o tempo conta de quando
 * ela assume, não de quando a conversa nasceu, porque a espera na fila não é
 * responsabilidade dela.
 */
export function Performance({
  performance,
  title,
  subtitle,
}: {
  performance: AgentPerformance | null
  title: string
  subtitle?: string
}) {
  if (!performance) {
    return (
      <div className="perf">
        <p className="history__empty">Carregando os números.</p>
      </div>
    )
  }

  return (
    <div className="perf">
      <header className="perf__head">
        <h2 className="perf__title">{title}</h2>
        {subtitle && <p className="perf__subtitle">{subtitle}</p>}
      </header>

      <div className="perf__cards">
        {cartoes(performance).map((c) => {
          const Icone = c.icon
          return (
            <article key={c.label} className="perf__card">
              <span className="perf__card-icon" aria-hidden="true">
                <Icone size={15} strokeWidth={2} />
              </span>
              <span className="perf__card-label">{c.label}</span>
              <span className="perf__card-value">{c.value}</span>
              {c.hint && <span className="perf__card-hint">{c.hint}</span>}
            </article>
          )
        })}
      </div>

      <section className="perf__block">
        <h3 className="perf__block-title">
          <Award size={13} strokeWidth={2.5} />
          Assuntos que você resolveu
        </h3>

        {performance.byIntent.length === 0 ? (
          <p className="perf__empty">
            Nenhum atendimento encerrado ainda. A distribuição por assunto aparece aqui conforme
            você conclui.
          </p>
        ) : (
          <ul className="perf__bars">
            {performance.byIntent.map((linha) => {
              const maior = performance.byIntent[0]?.total ?? 1
              return (
                <li key={linha.intent} className="perf__bar">
                  <span className="perf__bar-label">{intentLabel(linha.intent)}</span>
                  <span className="perf__bar-track">
                    <span
                      className="perf__bar-fill"
                      style={{ width: `${Math.max((linha.total / maior) * 100, 4)}%` }}
                    />
                  </span>
                  <span className="perf__bar-value">{linha.total}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

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
