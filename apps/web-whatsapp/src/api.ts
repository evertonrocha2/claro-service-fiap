export type Mensagem = {
  id: string
  sender: 'CUSTOMER' | 'BOT' | 'AGENT'
  text: string
  at: string
}

export type Conversa = {
  conversationId: string
  protocol: string
  status: string
  messages: Mensagem[]
}

export type Enviada = {
  conversationId: string
  protocol: string
  reply: string | null
}

async function json<T>(caminho: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(caminho, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })

  const dados = await resposta.json().catch(() => null)

  if (!resposta.ok) {
    const erro = (dados as { error?: { message: string } } | null)?.error
    throw new Error(erro?.message ?? 'Não foi possível concluir.')
  }

  return dados as T
}

export const api = {
  /**
   * Entra pela porta do canal WhatsApp, não pela porta web.
   *
   * O telefone vai no corpo porque é o canal que afirma de quem é a mensagem.
   * Quando a Meta entrar, o webhook preenche esse mesmo campo e nada aqui muda.
   */
  send: (text: string, phone: string, conversationId: string | null) =>
    json<Enviada>('/api/channels/whatsapp/messages', {
      method: 'POST',
      body: JSON.stringify(conversationId ? { text, phone, conversationId } : { text, phone }),
    }),

  load: (id: string) => json<Conversa>(`/api/conversations/${id}`),
}
