import type { ChatMessage, ConversationState } from '@sync/chat-ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'

const CHAVE = 'sync.conversa'
const INTERVALO_MS = 5000

const VAZIO: ConversationState = {
  conversationId: null,
  protocol: null,
  status: null,
  context: null,
}

/**
 * Conversa do cliente, com o servidor como fonte da verdade.
 *
 * Só o id fica no navegador. As mensagens vêm da API a cada consulta, o que
 * resolve duas coisas de uma vez: recarregar a página não perde mais o
 * atendimento, e a resposta do atendente chega até aqui. Antes ela ficava só no
 * console e a pessoa que esperava nunca a via.
 */
export function useConversation(token?: string) {
  const [estado, setEstado] = useState<ConversationState>(VAZIO)
  const [mensagens, setMensagens] = useState<ChatMessage[]>([])
  const [carregando, setCarregando] = useState(false)

  // Ref para o timer não se reinscrever a cada mensagem nova.
  const idRef = useRef<string | null>(null)

  const aplicar = useCallback((dados: Awaited<ReturnType<typeof api.loadConversation>>) => {
    idRef.current = dados.conversationId
    setEstado({
      conversationId: dados.conversationId,
      protocol: dados.protocol,
      status: dados.status,
      context: dados.context,
    })
    setMensagens(
      dados.messages.map((m) => ({
        id: m.id,
        role: m.sender,
        text: m.text,
        at: new Date(m.at),
      })),
    )
  }, [])

  const esquecer = useCallback(() => {
    idRef.current = null
    try {
      localStorage.removeItem(CHAVE)
    } catch {
      // Armazenamento bloqueado; a conversa vive só nesta aba.
    }
    setEstado(VAZIO)
    setMensagens([])
  }, [])

  const sincronizar = useCallback(async () => {
    const id = idRef.current
    if (!id) return
    try {
      aplicar(await api.loadConversation(id, token))
    } catch {
      // Conversa apagada ou de outro cliente. Recomeça em vez de insistir.
      esquecer()
    }
  }, [token, aplicar, esquecer])

  // Retoma o atendimento guardado ao abrir a página.
  useEffect(() => {
    let ativo = true
    try {
      const guardado = localStorage.getItem(CHAVE)
      if (!guardado) return
      idRef.current = guardado
      setCarregando(true)
      api
        .loadConversation(guardado, token)
        .then((d) => {
          if (ativo) aplicar(d)
        })
        .catch(() => {
          if (ativo) esquecer()
        })
        .finally(() => {
          if (ativo) setCarregando(false)
        })
    } catch {
      // Sem armazenamento: começa uma conversa nova.
    }
    return () => {
      ativo = false
    }
  }, [token, aplicar, esquecer])

  // Enquanto houver atendimento aberto, busca o que mudou do outro lado.
  useEffect(() => {
    const timer = setInterval(() => void sincronizar(), INTERVALO_MS)
    return () => clearInterval(timer)
  }, [sincronizar])

  const registrar = useCallback((id: string) => {
    idRef.current = id
    try {
      localStorage.setItem(CHAVE, id)
    } catch {
      // Sem armazenamento: a conversa continua nesta aba.
    }
  }, [])

  return {
    estado,
    mensagens,
    setEstado,
    setMensagens,
    registrar,
    esquecer,
    carregando,
    sincronizar,
  }
}
