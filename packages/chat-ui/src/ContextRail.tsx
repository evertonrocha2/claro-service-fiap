import { CHANNEL_LABELS, type ConversationState, INTENT_LABELS } from './types.js'

type Fato = {
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
 * A trilha de contexto.
 *
 * Todo chat esconde o que o sistema sabe. Aqui fica à vista, porque é o
 * argumento inteiro do Sync: o contexto acumula e viaja com você. Cada ponto
 * acende no instante em que o fato é descoberto.
 *
 * Vale também como transparência sob a LGPD: a pessoa vê exatamente qual dado
 * dela a conversa está guardando.
 */
export function ContextRail({ state, onHandoff, handoffBusy }: ContextRailProps) {
  const ctx = state.context

  const fatos: Fato[] = [
    {
      label: 'Cliente',
      value: ctx?.identified ? ctx.customerName : null,
      pending: 'ainda não identificado',
    },
    {
      label: 'Canal',
      value: ctx ? CHANNEL_LABELS[ctx.originChannel] : null,
      pending: 'aguardando',
    },
    {
      label: 'Assunto',
      value: ctx?.intent ? INTENT_LABELS[ctx.intent] : null,
      pending: 'ainda não entendi',
    },
    {
      label: 'Serviço',
      value: ctx?.serviceLabel ?? null,
      pending: 'nenhum relacionado',
    },
  ]

  const escalado = state.status === 'WAITING_HUMAN' || state.status === 'WITH_HUMAN'

  return (
    <aside className="sync-rail" aria-label="O que o Sync já sabe">
      <h2 className="sync-rail__title">O que já sabemos</h2>

      <ul className="sync-facts">
        {fatos.map((f) => (
          <li
            key={f.label}
            className={`sync-fact ${f.value ? 'sync-fact--known' : 'sync-fact--unknown'}`}
          >
            <span className="sync-fact__dot" aria-hidden="true" />
            <span>
              <span className="sync-fact__label">{f.label}</span>
              <span className="sync-fact__value">{f.value ?? f.pending}</span>
            </span>
          </li>
        ))}
      </ul>

      {state.protocol && (
        <div className="sync-protocol">
          <span className="sync-fact__label sync-protocol__label">Protocolo</span>
          <div className="sync-protocol__number">{state.protocol}</div>
        </div>
      )}

      {escalado && (
        <p className="sync-escalated">
          Um atendente vai continuar daqui. Ele recebe esta conversa inteira, então você não precisa
          explicar de novo.
        </p>
      )}

      {onHandoff && state.conversationId && !escalado && (
        <button type="button" className="sync-handoff" onClick={onHandoff} disabled={handoffBusy}>
          {handoffBusy ? 'Gerando link…' : 'Continuar no WhatsApp'}
          <small>Levamos o contexto junto</small>
        </button>
      )}

      <p className="sync-rail__note">
        Estes são os únicos dados seus nesta conversa. Nada além disso é guardado aqui.
      </p>
    </aside>
  )
}
