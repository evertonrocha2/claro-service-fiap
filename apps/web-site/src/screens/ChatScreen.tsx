import { AppHeader, ChatComposer, ChatTranscript, ContactPrompt, ContextRail } from '@sync/chat-ui'
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
  const [erroContato, setErroContato] = useState<string | null>(null)
  const [dispensouContato, setDispensouContato] = useState(false)
  const [gerandoLink, setGerandoLink] = useState(false)

  /**
   * Abre a continuidade no WhatsApp.
   *
   * O link ja vem com o codigo dentro da mensagem, e e ele que amarra a conversa
   * nova a esta. Abre em outra aba porque no celular o alvo e o aplicativo, e
   * perder esta pagina apagaria o atendimento da tela.
   */
  async function continuarNoWhatsApp() {
    if (!estado.conversationId) return
    setGerandoLink(true)
    try {
      const { url } = await api.handoff(estado.conversationId, sessao?.accessToken)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      setErro(e instanceof SyncApiError ? e.message : 'Não foi possível gerar o link.')
    } finally {
      setGerandoLink(false)
    }
  }

  /**
   * O pedido de telefone aparece depois da primeira troca, nunca antes.
   *
   * Cobrar o dado na porta transformaria o atendimento em cadastro. Depois da
   * primeira resposta a pessoa já viu utilidade, e o pedido faz sentido. Quem
   * está logado não vê: o cadastro dela já tem o número.
   */
  const pedirContato =
    !sessao &&
    !dispensouContato &&
    estado.conversationId !== null &&
    estado.context?.identified !== true &&
    mensagens.length >= 2

  async function salvarContato(telefone: string) {
    if (!estado.conversationId) return
    setErroContato(null)
    try {
      await api.setContact(estado.conversationId, telefone, sessao?.accessToken)
      setDispensouContato(true)
      await sincronizar()
    } catch (e) {
      setErroContato(e instanceof SyncApiError ? e.message : 'Não foi possível salvar o telefone.')
    }
  }

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

      // Sem resposta quando um atendente esta no comando. Adicionar a bolha de
      // qualquer jeito deixava um balao vazio do Sync no fim da conversa.
      if (r.reply) {
        setMensagens((atuais) => [
          ...atuais,
          { id: crypto.randomUUID(), role: 'BOT', text: r.reply as string, at: new Date() },
        ])
      }
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
        title="Central de Atendimento"
        {...(sessao ? { identity: { name: sessao.customer.name }, onSignOut: onSair } : {})}
        {...(sessao ? {} : { onSignIn: onEntrar })}
      />

      <ContextRail state={estado} onHandoff={continuarNoWhatsApp} handoffBusy={gerandoLink} />

      {pedirContato && (
        <ContactPrompt
          onSubmit={salvarContato}
          onSkip={() => setDispensouContato(true)}
          error={erroContato}
        />
      )}

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
