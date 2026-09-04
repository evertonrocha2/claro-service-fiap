import {
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Hand,
  Lightbulb,
  MousePointerClick,
  RefreshCw,
  Send,
} from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
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
  const [ofertaAberta, setOfertaAberta] = useState(false)

  /**
   * A conversa abre na ultima mensagem, nao na primeira.
   *
   * Sem isto o atendente assume um atendimento e le a primeira coisa que a
   * pessoa disse, precisando rolar para achar onde a conversa esta. Vale ainda
   * mais depois da troca de canal, porque o que interessa esta no fim.
   */
  const fimDaConversa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fimDaConversa.current?.scrollIntoView({ block: 'end' })
  }, [detail.id, detail.messages.length])

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

            <button
              className="offer__refresh"
              type="button"
              onClick={() => setOfertaAberta((v) => !v)}
              aria-expanded={ofertaAberta}
              aria-label={ofertaAberta ? 'Recolher sugestão' : 'Abrir sugestão'}
            >
              {ofertaAberta ? (
                <ChevronUp size={14} strokeWidth={2.4} />
              ) : (
                <ChevronDown size={14} strokeWidth={2.4} />
              )}
            </button>
          </header>

          <p className="offer__headline">{detail.offer.headline}</p>

          {/* O corpo vem recolhido. A conversa e a razao desta tela existir, e
              com a sugestao toda aberta ela sobrava com duas mensagens visiveis,
              justamente onde o atendente le o historico do site e do WhatsApp
              juntos. A justificativa continua a um clique. */}
          {ofertaAberta && (
            <>
              <p className="offer__rationale">{detail.offer.rationale}</p>

              <p className="offer__meta">
                {detail.offer.source === 'LLM' ? 'Gerada por IA' : 'Gerada por regras'} ·{' '}
                {Math.round(detail.offer.confidence * 100)}% de confiança
              </p>
            </>
          )}
        </section>
      )}

      <div className="detail__thread">
        {/* A troca de canal ganha uma marca na propria conversa.
            Depois que cada canal do cliente passou a mostrar so o que passou por
            ele, este console e o unico lugar que ve as duas pontas juntas. Sem
            esta linha o atendente le tudo como se fosse uma conversa continua e
            nao percebe que a pessoa saiu do site e esta no WhatsApp agora. */}
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

        <div ref={fimDaConversa} />
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
