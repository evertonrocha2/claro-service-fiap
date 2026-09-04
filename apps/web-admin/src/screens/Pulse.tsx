import { type Metrics, formatWait } from '../api.js'

/**
 * A faixa responde a pergunta que o gestor faz ao chegar: o que esta pegando
 * fogo agora. Nada de historico aqui, so o estado deste instante.
 */
export function Pulse({ metrics }: { metrics: Metrics | null }) {
  if (!metrics) return <div className="pulse" />

  const esperaCritica = metrics.worstWaitSeconds >= 300

  return (
    <div className="pulse">
      <div className={`pulse__cell ${metrics.waiting > 0 ? 'pulse__cell--alert' : ''}`}>
        <span className="pulse__label">Esperando</span>
        <span className="pulse__value">{metrics.waiting}</span>
      </div>

      <div className="pulse__cell">
        <span className="pulse__label">Em atendimento</span>
        <span className="pulse__value">{metrics.withAgent}</span>
      </div>

      <div className="pulse__cell">
        <span className="pulse__label">Com a IA agora</span>
        <span className="pulse__value">{metrics.withBot}</span>
      </div>

      <div className={`pulse__cell ${esperaCritica ? 'pulse__cell--alert' : ''}`}>
        <span className="pulse__label">Pior espera</span>
        <span className="pulse__value">{formatWait(metrics.worstWaitSeconds)}</span>
      </div>

      <div className="pulse__cell">
        <span className="pulse__label">Resolvido pela IA</span>
        <span className="pulse__value">
          {Math.round(metrics.botResolutionRate * 100)}
          <small>%</small>
        </span>
      </div>

      <div className="pulse__cell">
        <span className="pulse__label">Resolvidos hoje</span>
        <span className="pulse__value">{metrics.resolvedToday}</span>
      </div>

      {/* O numero que justifica o projeto inteiro. */}
      <div className="pulse__cell">
        <span className="pulse__label">Trocaram de canal</span>
        <span className="pulse__value">{metrics.channelHandoffs}</span>
      </div>
    </div>
  )
}
