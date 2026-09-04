import { AppHeader, ChatComposer, ChatTranscript, ContextRail } from '@sync/chat-ui'
import { useState } from 'react'
import { api, type Session, SyncApiError } from '../api.js'
import { useConversation } from '../useConversation.js'

export type ChatScreenProps = {
  sessao: Session | null
  onSair: () => void
  onEntrar: () => void
}

export function ChatScreen({ sessao, onSair, onEntrar }: ChatScreenProps) {
  const { estado, mensagens, setEstado, setMensagens, registrar, carregando, sincronizar } =
    useConversation(sessao?.accessToken)

  const [aguardando, setAguardando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function enviar(texto: string) {
    setErro(null)

    // Mostra a mensagem antes da resposta chegar. A próxima sincronização troca
    // este id provisório pelo do servidor.
    setMensagens((atuais) => [
      ...atuais,
      { id: crypto.randomUUID(), role: 'CUSTOMER', text: texto, at: new Date() },
    ])
    setAguardando(true)

    try {
      const r = await api.sendMessage(texto, estado.conversationId, sessao?.accessToken)
      registrar(r.conversationId)

      setEstado({
        conversationId: r.conversationId,
        protocol: r.protocol,
        status: r.status,
        context: r.context,
      })

      setMensagens((atuais) => [
        ...atuais,
        { id: crypto.randomUUID(), role: 'BOT', text: r.reply, at: new Date() },
      ])
    } catch (e) {
      setErro(
        e instanceof SyncApiError ? e.message : 'Sem conexão com o servidor. Tente novamente.',
      )
      void sincronizar()
    } finally {
      setAguardando(false)
    }
  }

  const vazio = carregando
    ? 'Carregando seu atendimento.'
    : sessao
      ? `Olá, ${sessao.customer.name.split(' ')[0]}. Descreva o que está acontecendo e resolvemos por aqui.`
      : 'Descreva o que está acontecendo. Posso ajudar com fatura, problema técnico ou seu plano.'

  const comAtendente = estado.status === 'WAITING_HUMAN' || estado.status === 'WITH_HUMAN'

  return (
    <div className="sync app">
      <AppHeader
        area="site"
        title="Central de Atendimento"
        {...(sessao ? { identity: { name: sessao.customer.name }, onSignOut: onSair } : {})}
        {...(sessao ? {} : { onSignIn: onEntrar })}
      />

      <ContextRail state={estado} />

      <main className="conversation">
        <ChatTranscript messages={mensagens} waiting={aguardando} emptyMessage={vazio} />

        {erro && (
          <p className="alert alert--error conversation__error" role="alert">
            {erro}
          </p>
        )}

        <ChatComposer
          onSend={enviar}
          disabled={aguardando}
          placeholder={comAtendente ? 'Escreva para o atendente' : 'Escreva sua mensagem'}
        />
      </main>
    </div>
  )
}
