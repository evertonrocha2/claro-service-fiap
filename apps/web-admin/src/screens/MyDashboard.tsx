import { ArrowLeft, Award, CheckCircle2, Headset, Timer, TrendingUp } from 'lucide-react'
import type { ComponentType } from 'react'
import {
  type AgentPerformance,
  CHANNEL_LABELS,
  formatWait,
  INTENT_COLUMNS,
  type QueueItem,
} from '../api.js'

function intentLabel(intent: QueueItem['intent']): string {
  if (!intent) return 'Não classificado'
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
    { icon: Headset, label: 'Em atendimento agora', value: String(p.handlingNow) },
    { icon: CheckCircle2, label: 'Encerrados hoje', value: String(p.resolvedToday) },
    { icon: TrendingUp, label: 'Encerrados no total', value: String(p.resolvedTotal) },
    {
      icon: Timer,
      label: 'Tempo médio de atendimento',
      // Nulo e zero dizem coisas diferentes. Zero afirmaria resolução
      // instantânea; o traço diz que ainda não há medida.
      value: p.avgHandlingSeconds === null ? '—' : formatWait(p.avgHandlingSeconds),
      hint: 'Do momento em que assume até encerrar',
    },
  ]
}

export type MyDashboardProps = {
  performance: AgentPerformance | null
  conversations: QueueItem[]
  onSelect: (id: string) => void
  selectedId: string | null
  /** Preenchido quando um gestor abre o painel de outra pessoa. */
  viewingOther?: { name: string; role: string } | undefined
  onBack?: (() => void) | undefined
}

/**
 * Painel de uma pessoa: os números dela e os atendimentos na mão dela, juntos.
 *
 * Antes os números só existiam no detalhe que o gestor abria pela aba da equipe,
 * e um atendente não tinha caminho nenhum até os próprios. Separar "meus
 * números" de "meus atendimentos" em duas telas também obrigava a pular entre
 * elas para responder a mesma pergunta.
 */
export function MyDashboard({
  performance,
  conversations,
  onSelect,
  selectedId,
  viewingOther,
  onBack,
}: MyDashboardProps) {
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
        {onBack && (
          <button className="perf__back" type="button" onClick={onBack}>
            <ArrowLeft size={14} strokeWidth={2} />
            Voltar para a equipe
          </button>
        )}

        <h2 className="perf__title">{viewingOther ? viewingOther.name : 'Meu painel'}</h2>
        <p className="perf__subtitle">
          {viewingOther
            ? viewingOther.role
            : 'Seus números e os atendimentos que estão com você agora.'}
        </p>
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

      <div className="perf__columns">
        <section className="perf__block">
          <h3 className="perf__block-title">
            <Headset size={13} strokeWidth={2.5} />
            {viewingOther ? 'Atendimentos em andamento' : 'Na sua mão agora'}
          </h3>

          {conversations.length === 0 ? (
            <p className="perf__empty">
              {viewingOther
                ? 'Nenhum atendimento em andamento no momento.'
                : 'Nenhum atendimento com você agora. Assuma alguém na fila para começar.'}
            </p>
          ) : (
            <ul className="perf__list">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="perf__item"
                    aria-current={c.id === selectedId}
                    onClick={() => onSelect(c.id)}
                  >
                    <span className="perf__item-who">{c.customerName ?? 'Não identificado'}</span>
                    <span className="perf__item-meta">
                      {intentLabel(c.intent)} · {CHANNEL_LABELS[c.channel]} ·{' '}
                      {formatWait(c.waitingSeconds)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="perf__block">
          <h3 className="perf__block-title">
            <Award size={13} strokeWidth={2.5} />
            Assuntos encerrados
          </h3>

          {performance.byIntent.length === 0 ? (
            <p className="perf__empty">
              Nenhum atendimento encerrado ainda. A distribuição por assunto aparece conforme os
              atendimentos são concluídos.
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
    </div>
  )
}
