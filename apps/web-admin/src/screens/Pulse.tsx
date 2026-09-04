import { CheckCircle2, Clock, Headset, Repeat2, Sparkles, Timer, Users } from 'lucide-react'
import type { ComponentType } from 'react'
import { formatWait, type Metrics } from '../api.js'

type Indicador = {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  label: string
  value: string
  suffix?: string
  alert?: boolean
}

/**
 * Indicadores do momento, separados em dois grupos.
 *
 * Sete números lado a lado sem hierarquia obrigavam a ler tudo para achar
 * qualquer coisa. À esquerda o que exige ação agora; à direita o que já foi
 * entregue. São perguntas diferentes e agora ficam visivelmente diferentes.
 */
export function Pulse({ metrics }: { metrics: Metrics | null }) {
  if (!metrics) return <div className="pulse" />

  const agora: Indicador[] = [
    {
      icon: Users,
      label: 'Aguardando',
      value: String(metrics.waiting),
      alert: metrics.waiting > 0,
    },
    { icon: Headset, label: 'Em atendimento', value: String(metrics.withAgent) },
    { icon: Sparkles, label: 'Com a assistente', value: String(metrics.withBot) },
    {
      icon: Timer,
      label: 'Maior espera',
      value: formatWait(metrics.worstWaitSeconds),
      alert: metrics.worstWaitSeconds >= 300,
    },
  ]

  const resultado: Indicador[] = [
    {
      icon: Sparkles,
      label: 'Resolução automática',
      value: String(Math.round(metrics.botResolutionRate * 100)),
      suffix: '%',
    },
    { icon: CheckCircle2, label: 'Encerrados hoje', value: String(metrics.resolvedToday) },
    { icon: Repeat2, label: 'Continuidade entre canais', value: String(metrics.channelHandoffs) },
  ]

  return (
    <div className="pulse">
      <Grupo titulo="Operação agora" icone={Clock} itens={agora} />
      <Grupo titulo="Resultado do dia" icone={CheckCircle2} itens={resultado} />
    </div>
  )
}

function Grupo({
  titulo,
  icone: Icone,
  itens,
}: {
  titulo: string
  icone: ComponentType<{ size?: number; strokeWidth?: number }>
  itens: Indicador[]
}) {
  return (
    <section className="pulse__group">
      <h2 className="pulse__group-title">
        <Icone size={13} strokeWidth={2.5} />
        {titulo}
      </h2>

      <div className="pulse__cells">
        {itens.map((i) => {
          const IconeItem = i.icon
          return (
            <div key={i.label} className={`pulse__cell ${i.alert ? 'is-alert' : ''}`}>
              <span className="pulse__label">
                <IconeItem size={13} strokeWidth={2} />
                {i.label}
              </span>
              <span className="pulse__value">
                {i.value}
                {i.suffix && <small>{i.suffix}</small>}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
