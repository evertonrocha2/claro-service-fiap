import { useState } from 'react'
import {
  CHANNEL_LABELS,
  ConsoleError,
  type ConversationDetail,
  INTENT_COLUMNS,
  STATUS_LABELS,
  formatWait,
  api,
} from '../api.js'

const QUEM: Record<ConversationDetail['messages'][number]['sender'], string> = {
  CUSTOMER: 'Cliente',
  BOT: 'Sync',
  AGENT: 'Atendente',
}

function intentLabel(intent: ConversationDetail['intent']): string {
  if (!intent) return 'Ainda identificando'
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
        <div>
          <span className="fact__label">Assunto</span>
          <span className="fact__value">{intentLabel(detail.intent)}</span>
        </div>
        <div>
          <span className="fact__label">Situação</span>
          <span className="fact__value">{STATUS_LABELS[detail.status]}</span>
        </div>
        <div>
          <span className="fact__label">Canal agora</span>
          <span className="fact__value">{CHANNEL_LABELS[detail.channel]}</span>
        </div>
        <div>
          <span className="fact__label">Começou em</span>
          <span className="fact__value">{CHANNEL_LABELS[detail.originChannel]}</span>
        </div>
        <div>
          <span className="fact__label">CPF</span>
          <span className="fact__value fact__value--mono">
            {detail.customerCpfMasked ?? 'não informado'}
          </span>
        </div>
        <div>
          <span className="fact__label">Esperando há</span>
          <span className="fact__value fact__value--mono">
            {formatWait(detail.waitingSeconds)}
          </span>
        </div>
        {detail.serviceLabel && (
          <div style={{ gridColumn: '1 / -1' }}>
            <span className="fact__label">Serviço</span>
            <span className="fact__value">{detail.serviceLabel}</span>
          </div>
        )}
      </div>

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
          <p className="notice">Atendimento encerrado. O histórico fica guardado.</p>
        ) : podeAssumir ? (
          <>
            <p className="notice">
              O cliente já contou tudo acima. Assuma para responder sem pedir nada de novo.
            </p>
            <button
              className="btn btn--primary"
              type="button"
              disabled={ocupado}
              onClick={() => agir(() => api.claim(token, detail.id))}
            >
              Assumir atendimento
            </button>
          </>
        ) : (
          <>
            <div className="detail__reply">
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Escreva para o cliente"
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
                Enviar
              </button>
              <button
                className="btn"
                type="button"
                disabled={ocupado}
                onClick={() => agir(() => api.resolve(token, detail.id))}
              >
                Encerrar
              </button>
            </div>
            {!meu && (
              <p className="notice">
                Este atendimento está com {detail.assignedAgentName ?? 'a IA'}. Você pode
                acompanhar, mas não responder.
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
      Escolha alguém no quadro para ver a conversa inteira e o que o Sync já descobriu.
    </div>
  )
}
