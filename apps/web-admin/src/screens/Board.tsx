import {
  CHANNEL_LABELS,
  INTENT_COLUMNS,
  type QueueItem,
  formatWait,
  waitHeat,
} from '../api.js'

export type BoardProps = {
  items: QueueItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}

const URGENTE_SEGUNDOS = 300

function Card({
  item,
  selected,
  onSelect,
}: {
  item: QueueItem
  selected: boolean
  onSelect: () => void
}) {
  const calor = waitHeat(item.waitingSeconds)
  const urgente = item.waitingSeconds >= URGENTE_SEGUNDOS

  return (
    <button type="button" className="card" aria-selected={selected} onClick={onSelect}>
      {/* A barra cresce com a espera e vira vermelha ao passar de cinco minutos. */}
      <span
        className={`card__spine ${urgente ? 'card__spine--urgent' : ''}`}
        style={{ height: `${Math.max(calor * 100, 6)}%` }}
        aria-hidden="true"
      />

      <div className={`card__who ${item.customerName ? '' : 'card__who--unknown'}`}>
        {item.customerName ?? 'Não identificado'}
      </div>

      <div className="card__meta">
        <span className={urgente ? 'card__wait--urgent' : undefined}>
          {formatWait(item.waitingSeconds)}
        </span>
        <span aria-hidden="true">·</span>
        <span>{CHANNEL_LABELS[item.channel]}</span>
        {item.originChannel !== item.channel && (
          <>
            <span aria-hidden="true">·</span>
            <span title="Começou em outro canal">veio do {CHANNEL_LABELS[item.originChannel]}</span>
          </>
        )}
      </div>

      {item.lastMessage && <p className="card__last">{item.lastMessage}</p>}

      {item.assignedAgentName && <div className="card__agent">{item.assignedAgentName}</div>}
    </button>
  )
}

/**
 * A fila como colunas de intenção.
 *
 * Um dashboard de suporte costuma ser uma tabela com um filtro. Aqui a coluna é o
 * motivo pelo qual a pessoa procurou a Claro, então dá para ver de longe que
 * cancelamento está empilhando. As colunas estão em ordem de custo de ignorar,
 * definida em INTENT_COLUMNS, e não por volume nem alfabeto.
 */
export function Board({ items, selectedId, onSelect }: BoardProps) {
  return (
    <div className="board">
      {INTENT_COLUMNS.map((coluna) => {
        const daColuna = items.filter((i) => (i.intent ?? 'DESCONHECIDA') === coluna.intent)
        const quente = coluna.intent === 'CANCELAMENTO' && daColuna.length > 0

        return (
          <section key={coluna.intent} className={`column ${quente ? 'column--hot' : ''}`}>
            <header className="column__head">
              <h2 className="column__name">{coluna.label}</h2>
              <span className="column__count">{daColuna.length}</span>
            </header>

            <div className="column__body">
              {daColuna.length === 0 ? (
                <p className="column__empty">Ninguém esperando aqui.</p>
              ) : (
                daColuna.map((item) => (
                  <Card
                    key={item.id}
                    item={item}
                    selected={item.id === selectedId}
                    onSelect={() => onSelect(item.id)}
                  />
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
