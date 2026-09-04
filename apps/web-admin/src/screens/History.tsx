import {
  CHANNEL_LABELS,
  INTENT_COLUMNS,
  type QueueItem,
  STATUS_LABELS,
  formatWait,
} from '../api.js'

const PILL: Record<QueueItem['status'], string> = {
  RESOLVED: 'pill--resolved',
  WAITING_HUMAN: 'pill--waiting',
  WITH_HUMAN: 'pill--with-human',
  BOT: '',
}

function intentLabel(intent: QueueItem['intent']): string {
  if (!intent) return 'Sem intenção clara'
  return INTENT_COLUMNS.find((c) => c.intent === intent)?.label ?? intent
}

export function History({
  items,
  onSelect,
}: {
  items: QueueItem[]
  onSelect: (id: string) => void
}) {
  if (items.length === 0) {
    return (
      <div className="history">
        <p className="notice">
          Nada encerrado ainda. Conforme a equipe for resolvendo, o histórico aparece aqui.
        </p>
      </div>
    )
  }

  return (
    <div className="history">
      <table className="history__table">
        <thead>
          <tr>
            <th>Protocolo</th>
            <th>Cliente</th>
            <th>Assunto</th>
            <th>Canal</th>
            <th>Jornada</th>
            <th>Situação</th>
            <th>Última mensagem</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="history__row" onClick={() => onSelect(i.id)}>
              <td className="mono">{i.protocol}</td>
              <td>{i.customerName ?? '—'}</td>
              <td>{intentLabel(i.intent)}</td>
              <td>{CHANNEL_LABELS[i.channel]}</td>
              <td className="mono">
                {i.originChannel === i.channel
                  ? 'um canal só'
                  : `${CHANNEL_LABELS[i.originChannel]} → ${CHANNEL_LABELS[i.channel]}`}
              </td>
              <td>
                <span className={`pill ${PILL[i.status]}`}>{STATUS_LABELS[i.status]}</span>
              </td>
              <td className="mono">{formatWait(i.waitingSeconds)} atrás</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
