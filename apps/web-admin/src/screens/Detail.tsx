import { CircleCheck, Hand, Lightbulb, MousePointerClick, RefreshCw, Send } from 'lucide-react'
import { useState } from 'react'
import {
  api,
  CHANNEL_LABELS,
  ConsoleError,
  type ConversationDetail,
  formatWait,
  INTENT_COLUMNS,
  OFFER_LABELS,
  STATUS_LABELS,
} from '../api.js'

const QUEM: Record<ConversationDetail['messages'][number]['sender'], string> = {
  CUSTOMER: 'Cliente',
  BOT: 'Sync',
  AGENT: 'Atendente',
}

function intentLabel(intent: ConversationDetail['intent']): string {
  if (!intent) return 'Em classificação'
  return INTENT_COLUMNS.find((c) => c.intent === intent)?.label ?? intent
}

export type DetailProps = {
  token: string
  detail: ConversationDetail
  agentId: string
  onChanged: () => void
}

export function Detail({ token, detail, agentId, onChanged }: DetailProps) {
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // Comparar por id, não por status: sem isso qualquer atendimento em andamento
  // pareceria meu, e o atendente só descobriria o contrário ao ver o envio falhar.
  const meu = detail.assignedAgentId === agentId && detail.status === 'WITH_HUMAN'
  const podeAssumir = detail.status === 'WAITING_HUMAN'
  const encerrado = detail.status === 'RESOLVED'

  async function agir(acao: () => Promise<unknown>) {
    setErro(null)
    setOcupado(true)
    try {
      await acao()
      onChanged()
    } catch (e) {
      setErro(e instanceof ConsoleError ? e.message : 'Não conseguimos falar com o servidor.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <aside className="detail" aria-label="Detalhe do atendimento">
      <header className="detail__head">
        <h2 className="detail__title">{detail.customerName ?? 'Cliente não identificado'}</h2>
        <span className="detail__protocol">Protocolo {detail.protocol}</span>
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

      {detail.offer && (
        <section className="offer" aria-label="Sugestão de oferta">
          <header className="offer__head">
            <span className="offer__icon" aria-hidden="true">
              <Lightbulb size={14} strokeWidth={2} />
            </span>
            <h3 className="offer__eyebrow">Sugestão de oferta</h3>
            <span className="offer__tag">
              {OFFER_LABELS[detail.offer.offerKind] ?? detail.offer.offerKind}
            </span>
            <button
              className="offer__refresh"
              type="button"
              disabled={ocupado}
              onClick={() => agir(() => api.refreshOffer(token, detail.id))}
              aria-label="Recalcular sugestão"
            >
              <RefreshCw size={13} strokeWidth={2} />
            </button>
          </header>

          <p className="offer__headline">{detail.offer.headline}</p>
          <p className="offer__rationale">{detail.offer.rationale}</p>

          <p className="offer__meta">
            {detail.offer.source === 'LLM' ? 'Gerada por IA' : 'Gerada por regras'} ·{' '}
            {Math.round(detail.offer.confidence * 100)}% de confiança
          </p>
        </section>
      )}

      <div className="detail__thread">
        {detail.messages.map((m) => (
          <div key={m.id} className={`msg msg--${m.sender.toLowerCase()}`}>
            <span className="msg__who">{QUEM[m.sender]}</span>
            {m.text}
          </div>
        ))}
      </div>

      <div className="detail__actions">
        {erro && (
          <p className="notice notice--error" role="alert">
            {erro}
          </p>
        )}

        {encerrado ? (
          <p className="notice">
            Atendimento encerrado. O histórico permanece disponível para consulta.
          </p>
        ) : podeAssumir ? (
          <>
            <p className="notice">
              O cliente já registrou a solicitação acima. Assuma o atendimento para responder sem
              solicitar as informações novamente.
            </p>
            <button
              className="btn btn--primary"
              type="button"
              disabled={ocupado}
              onClick={() => agir(() => api.claim(token, detail.id))}
            >
              <Hand size={15} strokeWidth={2} />
              Assumir atendimento
            </button>
          </>
        ) : (
          <>
            <div className="detail__reply">
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Escreva a resposta ao cliente"
                rows={2}
                aria-label="Resposta ao cliente"
                disabled={ocupado || !meu}
              />
            </div>
            <div className="btn--row">
              <button
                className="btn btn--primary"
                type="button"
                disabled={ocupado || texto.trim().length === 0 || !meu}
                onClick={() =>
                  agir(async () => {
                    await api.reply(token, detail.id, texto.trim())
                    setTexto('')
                  })
                }
              >
                <Send size={14} strokeWidth={2} />
                Enviar
              </button>
              <button
                className="btn"
                type="button"
                disabled={ocupado}
                onClick={() => agir(() => api.resolve(token, detail.id))}
              >
                <CircleCheck size={14} strokeWidth={2} />
                Encerrar
              </button>
            </div>
            {!meu && (
              <p className="notice">
                Atendimento sob responsabilidade de{' '}
                {detail.assignedAgentName ?? 'atendimento automático'}. Consulta permitida, resposta
                indisponível.
              </p>
            )}
          </>
        )}
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
