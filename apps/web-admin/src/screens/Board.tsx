import { ArrowRight, Clock, ExternalLink, Sparkles } from 'lucide-react'
import { CHANNEL_LABELS, formatWait, INTENT_COLUMNS, type QueueItem } from '../api.js'
import { ticketHref } from '../route.js'

export type BoardProps = {
  items: QueueItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}

const URGENTE_SEGUNDOS = 300

/** Iniciais para o disco do responsavel, no maximo duas. */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  const primeira = partes[0]?.[0] ?? ''
  const ultima = partes.length > 1 ? (partes.at(-1)?.[0] ?? '') : ''
  return (primeira + ultima).toUpperCase()
}

/**
 * Cartão no formato de quadro de tarefas.
 *
 * O que a pessoa pediu virou o título, e não o nome dela: a coluna já diz a
 * intenção, e o que distingue um cartão do outro dentro da mesma coluna é o
 * pedido. Abaixo vêm as etiquetas de canal e situação, e o rodapé junta quem é
 * o cliente com quem está atendendo.
 */
function Card({
  item,
  selected,
  onSelect,
}: {
  item: QueueItem
  selected: boolean
  onSelect: () => void
}) {
  // Conversa da assistente não está esperando uma pessoa, então não fica
  // vermelha por tempo: o cronômetro ali mediria a coisa errada.
  const comAssistente = item.status === 'BOT'
  const urgente = !comAssistente && item.waitingSeconds >= URGENTE_SEGUNDOS
  const cruzouCanal = item.originChannel !== item.channel

  // Sem mensagem do cliente o cartão ficaria sem título. Nesse caso o nome
  // assume o lugar, que é a única coisa que resta para distinguir a linha.
  const titulo = item.lastMessage ?? item.customerName ?? 'Atendimento sem mensagem'

  return (
    /* O cartão guarda dois destinos, e por isso deixou de ser um botão só.
       Clicar abre a prévia aqui do lado, que é o gesto de triagem. O ícone abre o
       atendimento inteiro em outra aba, para trabalhar sem perder a fila de
       vista. Um link dentro de um botão seria HTML inválido, então os dois são
       irmãos dentro do cartão. */
    /* Todos brancos. A situacao vive na etiqueta, nao no fundo: fundo diferente
       por estado fazia o quadro parecer ter dois tipos de cartao. */
    <article className={`card ${selected ? 'is-selected' : ''}`}>
      <a
        className="card__expand"
        href={ticketHref(item.id)}
        target="_blank"
        rel="noopener"
        title="Abrir o atendimento em outra aba"
        aria-label={`Abrir o atendimento de ${item.customerName ?? 'cliente não identificado'} em outra aba`}
      >
        <ExternalLink size={12} strokeWidth={2.2} aria-hidden="true" />
      </a>

      <button type="button" className="card__pick" aria-current={selected} onClick={onSelect}>
        <p className="card__summary">{titulo}</p>

        <div className="card__labels">
          {/* Cor por canal, como as etiquetas de um quadro de tarefas: e o que
              deixa ver de longe que uma coluna inteira veio do WhatsApp.
              Quando a conversa atravessou de canal, a origem entra na mesma
              etiqueta em vez de abrir uma segunda: duas etiquetas de canal
              quebravam a linha e faziam o cartao crescer so em alguns casos. */}
          <span
            className={`tagline tagline--${item.channel.toLowerCase()}`}
            title={
              cruzouCanal
                ? `Comecou em ${CHANNEL_LABELS[item.originChannel]} e continua em ${CHANNEL_LABELS[item.channel]}`
                : undefined
            }
          >
            {cruzouCanal && (
              <>
                {CHANNEL_LABELS[item.originChannel]}
                <ArrowRight size={9} strokeWidth={3} aria-hidden="true" />
              </>
            )}
            {CHANNEL_LABELS[item.channel]}
          </span>

          {comAssistente && (
            <span className="tagline tagline--bot">
              <Sparkles size={10} strokeWidth={2.4} aria-hidden="true" />
              Assistente
            </span>
          )}
        </div>

        <div className="card__foot">
          <span className={`card__wait ${urgente ? 'card__wait--urgent' : ''}`}>
            <Clock size={11} strokeWidth={2.2} aria-hidden="true" />
            {formatWait(item.waitingSeconds)}
          </span>

          {/* Corta com reticencias quando a coluna e estreita, e o nome inteiro
              fica no title. Cortar e melhor do que empurrar o disco para fora. */}
          <span
            className={`card__who ${item.customerName ? '' : 'card__who--unknown'}`}
            title={item.customerName ?? 'Cliente não identificado'}
          >
            {item.customerName ?? 'Não identificado'}
          </span>

          {item.assignedAgentName && (
            <span className="card__avatar" title={`Em atendimento por ${item.assignedAgentName}`}>
              {iniciais(item.assignedAgentName)}
            </span>
          )}
        </div>
      </button>
    </article>
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
                <p className="column__empty">Nenhum atendimento nesta fila.</p>
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
