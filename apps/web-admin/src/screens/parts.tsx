import {
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Hand,
  Lightbulb,
  RefreshCw,
  Send,
} from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import {
  api,
  CHANNEL_LABELS,
  ConsoleError,
  type ConversationDetail,
  INTENT_COLUMNS,
  OFFER_LABELS,
} from '../api.js'

const QUEM: Record<ConversationDetail['messages'][number]['sender'], string> = {
  CUSTOMER: 'Cliente',
  BOT: 'Sync',
  AGENT: 'Atendente',
}

export function intentLabel(intent: ConversationDetail['intent']): string {
  if (!intent) return 'Em classificação'
  return INTENT_COLUMNS.find((c) => c.intent === intent)?.label ?? intent
}

/**
 * Peças que a prévia da fila e a página inteira do atendimento dividem.
 *
 * Existem porque as duas telas mostram a mesma conversa e oferecem as mesmas
 * ações. Duplicar o formulário de resposta em dois arquivos deixaria as regras
 * de quem pode responder divergirem com o tempo, e é justamente a regra que não
 * pode divergir.
 */

// ---------- conversa ----------

export function Thread({ detail }: { detail: ConversationDetail }) {
  /**
   * A conversa abre na última mensagem, não na primeira.
   *
   * Sem isto o atendente assume um atendimento e lê a primeira coisa que a
   * pessoa disse, precisando rolar para achar onde a conversa está. Vale ainda
   * mais depois da troca de canal, porque o que interessa está no fim.
   */
  const fim = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' })
  }, [detail.id, detail.messages.length])

  return (
    <>
      {/* A troca de canal ganha uma marca na própria conversa.
          Depois que cada canal do cliente passou a mostrar só o que passou por
          ele, este console é o único lugar que vê as duas pontas juntas. Sem
          esta linha o atendente lê tudo como uma conversa contínua e não percebe
          que a pessoa saiu do site e está no WhatsApp agora. */}
      {detail.messages.map((m, i) => {
        const anterior = detail.messages[i - 1]
        const trocouDeCanal = anterior !== undefined && anterior.channel !== m.channel

        return (
          <Fragment key={m.id}>
            {trocouDeCanal && (
              <p className="thread__switch">
                <ArrowRightLeft size={13} strokeWidth={2.4} aria-hidden="true" />
                Continua no {CHANNEL_LABELS[m.channel]}
              </p>
            )}

            <div className={`msg msg--${m.sender.toLowerCase()}`}>
              <span className="msg__who">{QUEM[m.sender]}</span>
              {m.text}
            </div>
          </Fragment>
        )
      })}

      <div ref={fim} />
    </>
  )
}

// ---------- sugestão de oferta ----------

export type OfferCardProps = {
  token: string
  detail: ConversationDetail
  /** Na página inteira há espaço; na prévia da fila a justificativa vem recolhida. */
  startOpen?: boolean
  onChanged: () => void
}

export function OfferCard({ token, detail, startOpen = false, onChanged }: OfferCardProps) {
  const [aberta, setAberta] = useState(startOpen)
  const [ocupado, setOcupado] = useState(false)

  if (!detail.offer) return null
  const oferta = detail.offer

  async function recalcular() {
    setOcupado(true)
    try {
      await api.refreshOffer(token, detail.id)
      onChanged()
    } catch {
      // Recalcular é conveniência. Falhar aqui mantém a sugestão anterior.
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section className="offer" aria-label="Sugestão de oferta">
      <header className="offer__head">
        <span className="offer__icon" aria-hidden="true">
          <Lightbulb size={14} strokeWidth={2} />
        </span>
        <h3 className="offer__eyebrow">Sugestão de oferta</h3>
        <span className="offer__tag">{OFFER_LABELS[oferta.offerKind] ?? oferta.offerKind}</span>

        <button
          className="offer__refresh"
          type="button"
          disabled={ocupado}
          onClick={recalcular}
          aria-label="Recalcular sugestão"
        >
          <RefreshCw size={13} strokeWidth={2} />
        </button>

        <button
          className="offer__refresh"
          type="button"
          onClick={() => setAberta((v) => !v)}
          aria-expanded={aberta}
          aria-label={aberta ? 'Recolher sugestão' : 'Abrir sugestão'}
        >
          {aberta ? (
            <ChevronUp size={14} strokeWidth={2.4} />
          ) : (
            <ChevronDown size={14} strokeWidth={2.4} />
          )}
        </button>
      </header>

      <p className="offer__headline">{oferta.headline}</p>

      {/* Recolhida na prévia porque ali ela roubava a altura da conversa, que é
          a razão daquela coluna existir. */}
      {aberta && (
        <>
          <p className="offer__rationale">{oferta.rationale}</p>
          <p className="offer__meta">
            {oferta.source === 'LLM' ? 'Gerada por IA' : 'Gerada por regras'} ·{' '}
            {Math.round(oferta.confidence * 100)}% de confiança
          </p>
        </>
      )}
    </section>
  )
}

// ---------- ações ----------

export type ActionsProps = {
  token: string
  detail: ConversationDetail
  agentId: string
  onChanged: () => void
}

export function Actions({ token, detail, agentId, onChanged }: ActionsProps) {
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
    <>
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
    </>
  )
}
