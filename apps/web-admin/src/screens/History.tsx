import {
  CHANNEL_LABELS,
  formatWait,
  INTENT_COLUMNS,
  type QueueItem,
  STATUS_LABELS,
} from '../api.js'

const PILL: Record<QueueItem['status'], string> = {
  RESOLVED: 'pill--resolved',
  WAITING_HUMAN: 'pill--waiting',
  WITH_HUMAN: 'pill--with-human',
  BOT: '',
}

function intentLabel(intent: QueueItem['intent']): string {
  if (!intent) return 'Não classificado'
  return INTENT_COLUMNS.find((c) => c.intent === intent)?.label ?? intent
}

export type HistoryProps = {
  items: QueueItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  filtered: boolean
}

/**
 * Grid com colunas declaradas no CSS, não uma tabela.
 *
 * O auto-layout de <table> mede cada célula pelo conteúdo, então uma mensagem
 * longa numa linha empurrava as colunas de todas as outras e a lista inteira
 * parecia desalinhada. Aqui a largura de cada coluna é decidida antes do
 * conteúdo, e uma linha não interfere na vizinha.
 */
export function History({ items, selectedId, onSelect, filtered }: HistoryProps) {
  if (items.length === 0) {
    return (
      <div className="history">
        <p className="history__empty">
          {filtered
            ? 'Nenhum atendimento corresponde aos filtros selecionados.'
            : 'Nenhum atendimento encerrado até o momento. Os registros aparecem aqui conforme a equipe conclui os atendimentos.'}
        </p>
      </div>
    )
  }

  return (
    <div className="history">
      <div className="history__head" aria-hidden="true">
        <span>Protocolo</span>
        <span>Cliente</span>
        <span>Assunto</span>
        <span>Jornada</span>
        <span>Situação</span>
        <span>Encerrado há</span>
      </div>

      {items.map((i) => {
        const trocou = i.originChannel !== i.channel
        return (
          <button
            key={i.id}
            type="button"
            className="history__row"
            aria-current={i.id === selectedId}
            onClick={() => onSelect(i.id)}
          >
            <span className="history__cell mono">{i.protocol}</span>
            <span className="history__cell history__cell--strong">{i.customerName ?? '—'}</span>
            <span className="history__cell">{intentLabel(i.intent)}</span>
            <span className={`history__cell journey ${trocou ? 'journey--crossed' : ''}`}>
              {trocou
                ? `${CHANNEL_LABELS[i.originChannel]} → ${CHANNEL_LABELS[i.channel]}`
                : CHANNEL_LABELS[i.channel]}
            </span>
            <span className="history__cell">
              <span className={`pill ${PILL[i.status]}`}>{STATUS_LABELS[i.status]}</span>
            </span>
            <span className="history__cell mono">{formatWait(i.waitingSeconds)}</span>
          </button>
        )
      })}
    </div>
  )
}
