import {
  ChatComposer,
  type ChatMessage,
  ChatTranscript,
  ClaroLogo,
  ContextRail,
  type ConversationState,
} from '@sync/chat-ui'
import { useState } from 'react'
import { api, type Session, SyncApiError } from '../api.js'

const ESTADO_INICIAL: ConversationState = {
  conversationId: null,
  protocol: null,
  status: null,
  context: null,
}

export type ChatScreenProps = {
  sessao: Session | null
  onSair: () => void
  onEntrar: () => void
}

export function ChatScreen({ sessao, onSair, onEntrar }: ChatScreenProps) {
  const [mensagens, setMensagens] = useState<ChatMessage[]>([])
  const [estado, setEstado] = useState<ConversationState>(ESTADO_INICIAL)
  const [aguardando, setAguardando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function enviar(texto: string) {
    setErro(null)
    setMensagens((atuais) => [
      ...atuais,
      { id: crypto.randomUUID(), role: 'CUSTOMER', text: texto, at: new Date() },
    ])
    setAguardando(true)

    try {
      const r = await api.sendMessage(texto, estado.conversationId, sessao?.accessToken)

      setEstado({
        conversationId: r.conversationId,
        protocol: r.protocol,
        status: r.status,
        context: r.context,
      })

      setMensagens((atuais) => [
        ...atuais,
        {
          id: crypto.randomUUID(),
          role: r.status === 'WAITING_HUMAN' ? 'BOT' : 'BOT',
          text: r.reply,
          at: new Date(),
        },
      ])
    } catch (e) {
      setErro(
        e instanceof SyncApiError ? e.message : 'Sem conexão com o servidor. Tente novamente.',
      )
    } finally {
      setAguardando(false)
    }
  }

  const vazio = sessao
    ? `Olá, ${sessao.customer.name.split(' ')[0]}. Conte o que está acontecendo e eu resolvo daqui.`
    : 'Conte o que está acontecendo. Posso ajudar com fatura, problema técnico ou seu plano.'

  return (
    <div className="sync app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">
            <ClaroLogo height={22} />
          </span>
          <span className="topbar__section">Central de Atendimento</span>
        </div>

        <div className="topbar__account">
          {sessao ? (
            <>
              <span className="topbar__name">{sessao.customer.name}</span>
              <button className="btn btn--link" type="button" onClick={onSair}>
                Sair
              </button>
            </>
          ) : (
            <button className="btn btn--link" type="button" onClick={onEntrar}>
              Entrar
            </button>
          )}
        </div>
      </header>

      <main className="workspace">
        <section className="conversation">
          <ChatTranscript messages={mensagens} waiting={aguardando} emptyMessage={vazio} />

          {erro && (
            <p className="alert alert--error conversation__error" role="alert">
              {erro}
            </p>
          )}

          <ChatComposer onSend={enviar} disabled={aguardando} placeholder="Escreva sua mensagem" />
        </section>

        <ContextRail state={estado} />
      </main>
    </div>
  )
}
