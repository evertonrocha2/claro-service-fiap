import { AppHeader } from '@sync/chat-ui'
import { ArrowLeft, AtSign, Hash, Package, Phone, Tag, User } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  type AgentSession,
  api,
  CHANNEL_LABELS,
  type ConversationDetail,
  formatWait,
  STATUS_LABELS,
} from '../api.js'
import { Actions, intentLabel, OfferCard, Thread } from './parts.js'

const INTERVALO_MS = 4000

export type TicketPageProps = {
  session: AgentSession
  conversationId: string
  onSignOut: () => void
}

/**
 * O atendimento em tela cheia, com endereço próprio.
 *
 * Existe porque a prévia ao lado da fila serve para triagem, não para trabalho:
 * numa coluna de 380px a conversa fica com quatro linhas visíveis e o atendente
 * lê o histórico de dois canais rolando de dez em dez pixels.
 *
 * Abre em outra aba de propósito. O quadro continua aberto atrás, com a fila
 * atualizando, então dá para atender uma pessoa aqui sem perder de vista quem
 * está esperando. E como o endereço é o do atendimento, a aba sobrevive a um F5
 * e o link pode ser passado a um colega.
 */
export function TicketPage({ session, conversationId, onSignOut }: TicketPageProps) {
  const [detalhe, setDetalhe] = useState<ConversationDetail | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const token = session.accessToken

  const carregar = useCallback(async () => {
    try {
      setDetalhe(await api.detail(token, conversationId))
      setErro(null)
    } catch {
      setErro('Não conseguimos carregar este atendimento.')
    }
  }, [token, conversationId])

  // A resposta do cliente chega enquanto esta aba está aberta, então a conversa
  // precisa buscar sozinha. Mais rápido que na fila porque aqui alguém está lendo.
  useEffect(() => {
    void carregar()
    const timer = setInterval(() => void carregar(), INTERVALO_MS)
    return () => clearInterval(timer)
  }, [carregar])

  return (
    <div className="shell shell--ticket">
      <AppHeader
        title="Atendimento"
        /* Saida obrigatoria. Quem chega por um link colado abre esta pagina na
           mesma aba, e sem isto ficaria preso numa tela sem menu. */
        nav={
          <a className="ticket__back" href="#">
            <ArrowLeft size={14} strokeWidth={2.2} aria-hidden="true" />
            Fila de atendimento
          </a>
        }
        identity={{
          name: session.agent.name,
          role: session.agent.role === 'MANAGER' ? 'Gestão' : 'Atendimento',
        }}
        onSignOut={onSignOut}
        aside={erro ? <span className="appbar__warn">{erro}</span> : null}
      />

      {!detalhe ? (
        <div className="ticket__loading">
          <p>{erro ?? 'Carregando o atendimento…'}</p>
        </div>
      ) : (
        <div className="ticket">
          <header className="ticket__head">
            <div className="ticket__id">
              <h1 className="ticket__who">{detalhe.customerName ?? 'Cliente não identificado'}</h1>
              <p className="ticket__protocol">
                <Hash size={13} strokeWidth={2.2} aria-hidden="true" />
                {detalhe.protocol}
              </p>
            </div>

            <dl className="ticket__stats">
              <div className="ticket__stat">
                <dt>Situação</dt>
                <dd>{STATUS_LABELS[detalhe.status]}</dd>
              </div>
              <div className="ticket__stat">
                <dt>Assunto</dt>
                <dd>{intentLabel(detalhe.intent)}</dd>
              </div>
              <div className="ticket__stat">
                <dt>Canal</dt>
                <dd>
                  {detalhe.originChannel === detalhe.channel
                    ? CHANNEL_LABELS[detalhe.channel]
                    : `${CHANNEL_LABELS[detalhe.originChannel]} → ${CHANNEL_LABELS[detalhe.channel]}`}
                </dd>
              </div>
              <div className="ticket__stat">
                <dt>Espera</dt>
                <dd className="ticket__stat--mono">{formatWait(detalhe.waitingSeconds)}</dd>
              </div>
              <div className="ticket__stat">
                <dt>Responsável</dt>
                <dd>{detalhe.assignedAgentName ?? 'Sem atendente'}</dd>
              </div>
            </dl>
          </header>

          <div className="ticket__body">
            <section className="ticket__talk" aria-label="Conversa">
              <div className="ticket__thread">
                <Thread detail={detalhe} />
              </div>

              <div className="ticket__actions">
                <Actions
                  token={token}
                  detail={detalhe}
                  agentId={session.agent.id}
                  onChanged={carregar}
                />
              </div>
            </section>

            <aside className="ticket__rail" aria-label="Dados do cliente">
              <h2 className="ticket__railtitle">Dados do cliente</h2>

              <ul className="ticket__facts">
                <li>
                  <User size={14} strokeWidth={2} aria-hidden="true" />
                  <span>Nome</span>
                  <strong>{detalhe.customerName ?? 'Não identificado'}</strong>
                </li>
                <li>
                  <Hash size={14} strokeWidth={2} aria-hidden="true" />
                  <span>CPF</span>
                  <strong className="ticket__mono">
                    {detalhe.customerCpfMasked ?? 'Não informado'}
                  </strong>
                </li>
                <li>
                  <Phone size={14} strokeWidth={2} aria-hidden="true" />
                  <span>Telefone</span>
                  <strong className="ticket__mono">
                    {detalhe.customerPhone ?? 'Não informado'}
                  </strong>
                </li>
                <li>
                  <AtSign size={14} strokeWidth={2} aria-hidden="true" />
                  <span>E-mail</span>
                  <strong>{detalhe.customerEmail ?? 'Não informado'}</strong>
                </li>
                <li>
                  <Package size={14} strokeWidth={2} aria-hidden="true" />
                  <span>Serviço</span>
                  <strong>{detalhe.serviceLabel ?? 'Nenhum relacionado'}</strong>
                </li>
                <li>
                  <Tag size={14} strokeWidth={2} aria-hidden="true" />
                  <span>Assunto</span>
                  <strong>{intentLabel(detalhe.intent)}</strong>
                </li>
              </ul>

              {/* Aqui a justificativa vem aberta: sobra altura, e a decisão de
                  oferecer algo acontece durante o atendimento, não na triagem. */}
              <OfferCard token={token} detail={detalhe} startOpen onChanged={carregar} />
            </aside>
          </div>
        </div>
      )}
    </div>
  )
}
