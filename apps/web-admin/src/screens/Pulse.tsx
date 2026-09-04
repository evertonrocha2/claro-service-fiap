import { formatWait, type Metrics } from '../api.js'

/**
 * Indicadores do momento. Nada de historico aqui: a faixa responde a primeira
 * pergunta de quem abre o console, que e como a operacao esta agora.
 */
export function Pulse({ metrics }: { metrics: Metrics | null }) {
  if (!metrics) return <div className="pulse" />

  const esperaCritica = metrics.worstWaitSeconds >= 300

  return (
    <div className="pulse">
      <div className={`pulse__cell ${metrics.waiting > 0 ? 'pulse__cell--alert' : ''}`}>
        <span className="pulse__label">Aguardando atendimento</span>
        <span className="pulse__value">{metrics.waiting}</span>
      </div>

      <div className="pulse__cell">
        <span className="pulse__label">Em atendimento humano</span>
        <span className="pulse__value">{metrics.withAgent}</span>
      </div>

      <div className="pulse__cell">
        <span className="pulse__label">Atendimento automático</span>
        <span className="pulse__value">{metrics.withBot}</span>
      </div>

      <div className={`pulse__cell ${esperaCritica ? 'pulse__cell--alert' : ''}`}>
        <span className="pulse__label">Maior tempo de espera</span>
        <span className="pulse__value">{formatWait(metrics.worstWaitSeconds)}</span>
      </div>

      <div className="pulse__cell">
        <span className="pulse__label">Resolução automática</span>
        <span className="pulse__value">
          {Math.round(metrics.botResolutionRate * 100)}
          <small>%</small>
        </span>
      </div>

      <div className="pulse__cell">
        <span className="pulse__label">Encerrados hoje</span>
        <span className="pulse__value">{metrics.resolvedToday}</span>
      </div>

      {/* O numero que justifica o projeto inteiro. */}
      <div className="pulse__cell">
        <span className="pulse__label">Continuidade entre canais</span>
        <span className="pulse__value">{metrics.channelHandoffs}</span>
      </div>
    </div>
  )
}
