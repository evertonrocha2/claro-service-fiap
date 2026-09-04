import type { Channel, ConversationStatus } from '@sync/contracts'
import { CHANNEL_LABELS } from '../api.js'

export type FilterState = {
  busca: string
  canal: Channel | null
  situacao: ConversationStatus | null
}

export const FILTRO_VAZIO: FilterState = { busca: '', canal: null, situacao: null }

export function filtrosAtivos(f: FilterState): boolean {
  return f.busca.trim() !== '' || f.canal !== null || f.situacao !== null
}

const CANAIS: Channel[] = ['SITE', 'APP', 'WHATSAPP']

const SITUACOES: { value: ConversationStatus; label: string }[] = [
  { value: 'WAITING_HUMAN', label: 'Aguardando' },
  { value: 'WITH_HUMAN', label: 'Em atendimento' },
]

export type FiltersProps = {
  value: FilterState
  onChange: (next: FilterState) => void
  showing: number
  total: number
  /** Situação não se aplica ao histórico, onde tudo já está encerrado. */
  withStatus?: boolean
}

export function Filters({ value, onChange, showing, total, withStatus = true }: FiltersProps) {
  const ativo = filtrosAtivos(value)

  return (
    <div className="filters">
      <div className="filters__search">
        <input
          type="search"
          value={value.busca}
          onChange={(e) => onChange({ ...value, busca: e.target.value })}
          placeholder="Buscar por nome, protocolo ou mensagem"
          aria-label="Buscar atendimentos"
        />
      </div>

      <div className="filters__group" role="group" aria-label="Filtrar por canal">
        <span className="filters__legend">Canal</span>
        {CANAIS.map((canal) => (
          <button
            key={canal}
            type="button"
            className="chip"
            aria-pressed={value.canal === canal}
            onClick={() => onChange({ ...value, canal: value.canal === canal ? null : canal })}
          >
            {CHANNEL_LABELS[canal]}
          </button>
        ))}
      </div>

      {withStatus && (
        <div className="filters__group" role="group" aria-label="Filtrar por situação">
          <span className="filters__legend">Situação</span>
          {SITUACOES.map((s) => (
            <button
              key={s.value}
              type="button"
              className="chip"
              aria-pressed={value.situacao === s.value}
              onClick={() =>
                onChange({ ...value, situacao: value.situacao === s.value ? null : s.value })
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <span className="filters__count">
        {ativo ? `Exibindo ${showing} de ${total}` : `${total} no total`}
      </span>

      {ativo && (
        <button type="button" className="filters__clear" onClick={() => onChange(FILTRO_VAZIO)}>
          Limpar filtros
        </button>
      )}
    </div>
  )
}

/** Filtragem no cliente: a lista já está em memória e a resposta é imediata. */
export function aplicarFiltros<
  T extends {
    customerName: string | null
    protocol: string
    lastMessage: string | null
    channel: string
    status: string
  },
>(itens: T[], f: FilterState): T[] {
  const termo = f.busca.trim().toLowerCase()

  return itens.filter((i) => {
    if (f.canal && i.channel !== f.canal) return false
    if (f.situacao && i.status !== f.situacao) return false
    if (!termo) return true

    return (
      (i.customerName ?? '').toLowerCase().includes(termo) ||
      i.protocol.includes(termo) ||
      (i.lastMessage ?? '').toLowerCase().includes(termo)
    )
  })
}
