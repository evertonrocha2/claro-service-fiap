import { Check, Hash, MessageCircleMore, Minus, Package, Tag, User } from 'lucide-react'
import type { ComponentType } from 'react'
import { CHANNEL_LABELS, type ConversationState, INTENT_LABELS } from './types.js'

type Fato = {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  label: string
  value: string | null
  pending: string
}

export type ContextRailProps = {
  state: ConversationState
  onHandoff?: () => void
  handoffBusy?: boolean
}

/**
 * Barra de contexto.
 *
 * Fica acima da conversa, na ordem em que se lê: primeiro o que o Sync já sabe,
 * depois o diálogo. Como coluna lateral ela ocupava uma faixa alta e quase vazia
 * e competia com a conversa pela atenção.
 *
 * É o argumento do produto à vista: o contexto acumula e viaja junto. Serve também
 * de transparência sob a LGPD, porque a pessoa vê exatamente qual dado dela a
 * conversa guarda.
 */
export function ContextRail({ state, onHandoff, handoffBusy }: ContextRailProps) {
  const ctx = state.context

  const fatos: Fato[] = [
    {
      icon: User,
      label: 'Cliente',
      value: ctx?.identified ? ctx.customerName : null,
      pending: 'Não identificado',
    },
    {
      icon: MessageCircleMore,
      label: 'Canal',
      value: ctx ? CHANNEL_LABELS[ctx.originChannel] : null,
      pending: 'Aguardando',
    },
    {
      icon: Tag,
      label: 'Assunto',
      value: ctx?.intent ? INTENT_LABELS[ctx.intent] : null,
      pending: 'Em classificação',
    },
    {
      icon: Package,
      label: 'Serviço',
      value: ctx?.serviceLabel ?? null,
      pending: 'Nenhum relacionado',
    },
  ]

  const escalado = state.status === 'WAITING_HUMAN' || state.status === 'WITH_HUMAN'

  return (
    <section className="ctx" aria-label="Dados identificados neste atendimento">
      <h2 className="ctx__title">Dados do atendimento</h2>

      <ul className="ctx__facts">
        {fatos.map((f) => {
          const Icone = f.icon
          const conhecido = f.value !== null

          return (
            <li key={f.label} className={`ctx__fact ${conhecido ? 'is-known' : ''}`}>
              <span className="ctx__icon" aria-hidden="true">
                <Icone size={15} strokeWidth={2} />
              </span>

              <span className="ctx__text">
                <span className="ctx__label">{f.label}</span>
                <span className="ctx__value">{f.value ?? f.pending}</span>
              </span>

              {/* Confirmação, não alerta. Ponto vermelho lia como problema; o que
                  esta linha diz é o oposto, que o dado já está resolvido. */}
              <span
                className="ctx__state"
                role="img"
                aria-label={conhecido ? 'Identificado' : 'Pendente'}
              >
                {conhecido ? (
                  <Check size={13} strokeWidth={3} />
                ) : (
                  <Minus size={13} strokeWidth={3} />
                )}
              </span>
            </li>
          )
        })}

        {state.protocol && (
          <li className="ctx__fact is-known ctx__fact--protocol">
            <span className="ctx__icon" aria-hidden="true">
              <Hash size={15} strokeWidth={2} />
            </span>
            <span className="ctx__text">
              <span className="ctx__label">Protocolo</span>
              <span className="ctx__value ctx__value--mono">{state.protocol}</span>
            </span>
          </li>
        )}
      </ul>

      {escalado && (
        <p className="ctx__note ctx__note--escalated">
          Um atendente assume a partir daqui e recebe esta conversa completa.
        </p>
      )}

      {onHandoff && state.conversationId && !escalado && (
        <button type="button" className="ctx__handoff" onClick={onHandoff} disabled={handoffBusy}>
          {handoffBusy ? 'Gerando link' : 'Continuar no WhatsApp'}
        </button>
      )}
    </section>
  )
}
