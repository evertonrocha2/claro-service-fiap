import { ExternalLink, MousePointerClick } from 'lucide-react'
import { CHANNEL_LABELS, type ConversationDetail, formatWait, STATUS_LABELS } from '../api.js'
import { ticketHref } from '../route.js'
import { Actions, intentLabel, OfferCard, Thread } from './parts.js'

export type DetailProps = {
  token: string
  detail: ConversationDetail
  agentId: string
  onChanged: () => void
}

/**
 * Prévia do atendimento, ao lado da fila.
 *
 * Serve para decidir sem sair do quadro: dá para ler a conversa, assumir e
 * responder daqui. Para trabalhar um atendimento demorado existe a página
 * inteira, que abre em outra aba e deixa esta lista intacta.
 */
export function Detail({ token, detail, agentId, onChanged }: DetailProps) {
  return (
    <aside className="detail" aria-label="Detalhe do atendimento">
      <header className="detail__head">
        <div className="detail__headtext">
          <h2 className="detail__title">{detail.customerName ?? 'Cliente não identificado'}</h2>
          <span className="detail__protocol">Protocolo {detail.protocol}</span>
        </div>

        <a
          className="detail__expand"
          href={ticketHref(detail.id)}
          target="_blank"
          rel="noopener"
          title="Abrir o atendimento em outra aba"
        >
          <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
          Abrir
        </a>
      </header>

      <div className="detail__facts">
        <div className="fact">
          <span className="fact__label">Assunto</span>
          <span className="fact__value">{intentLabel(detail.intent)}</span>
        </div>
        <div className="fact">
          <span className="fact__label">Situação</span>
          <span className="fact__value">{STATUS_LABELS[detail.status]}</span>
        </div>
        <div className="fact">
          <span className="fact__label">Canal atual</span>
          <span className="fact__value">{CHANNEL_LABELS[detail.channel]}</span>
        </div>
        <div className="fact">
          <span className="fact__label">Canal de origem</span>
          <span className="fact__value">{CHANNEL_LABELS[detail.originChannel]}</span>
        </div>
        <div className="fact">
          <span className="fact__label">CPF</span>
          <span className="fact__value fact__value--mono">
            {detail.customerCpfMasked ?? 'Não informado'}
          </span>
        </div>
        <div className="fact">
          <span className="fact__label">Tempo de espera</span>
          <span className="fact__value fact__value--mono">{formatWait(detail.waitingSeconds)}</span>
        </div>
        <div className="fact fact--wide">
          <span className="fact__label">Telefone</span>
          <span className="fact__value fact__value--mono">
            {detail.customerPhone ?? 'Não informado'}
          </span>
        </div>

        {detail.serviceLabel && (
          <div className="fact fact--wide">
            <span className="fact__label">Serviço</span>
            <span className="fact__value">{detail.serviceLabel}</span>
          </div>
        )}
      </div>

      <OfferCard token={token} detail={detail} onChanged={onChanged} />

      <div className="detail__thread">
        <Thread detail={detail} />
      </div>

      <div className="detail__actions">
        <Actions token={token} detail={detail} agentId={agentId} onChanged={onChanged} />
      </div>
    </aside>
  )
}

export function EmptyDetail() {
  return (
    <div className="empty-detail">
      <MousePointerClick size={26} strokeWidth={1.5} aria-hidden="true" />
      <p>Selecione um atendimento</p>
      <span>O histórico completo e os dados já identificados aparecem aqui.</span>
    </div>
  )
}
