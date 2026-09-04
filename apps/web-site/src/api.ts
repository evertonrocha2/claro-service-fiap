import type { ConversationState } from '@sync/chat-ui'

export type ApiError = { code: string; message: string }

export type Session = {
  accessToken: string
  refreshToken: string
  customer: { id: string; name: string; email: string }
}

export type SendMessageResult = {
  conversationId: string
  protocol: string
  reply: string
  intent: NonNullable<ConversationState['context']>['intent']
  status: NonNullable<ConversationState['status']>
  context: NonNullable<ConversationState['context']>
}

export class SyncApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function post<T>(caminho: string, corpo: unknown, token?: string): Promise<T> {
  const resposta = await fetch(caminho, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(corpo),
  })

  const dados = await resposta.json().catch(() => null)

  if (!resposta.ok) {
    const erro = (dados as { error?: ApiError } | null)?.error
    throw new SyncApiError(
      erro?.code ?? 'ERRO_DESCONHECIDO',
      erro?.message ?? 'Não foi possível concluir. Tente novamente.',
    )
  }

  return dados as T
}

export const api = {
  firstAccess: (cpf: string, email: string, password: string) =>
    post<{ customerId: string }>('/api/auth/first-access', { cpf, email, password }),

  login: (email: string, password: string) => post<Session>('/api/auth/login', { email, password }),

  logout: (refreshToken: string) => post<{ ok: true }>('/api/auth/logout', { refreshToken }),

  sendMessage: (text: string, conversationId: string | null, token?: string) =>
    post<SendMessageResult>(
      '/api/channels/site/messages',
      conversationId ? { text, conversationId } : { text },
      token,
    ),
}
