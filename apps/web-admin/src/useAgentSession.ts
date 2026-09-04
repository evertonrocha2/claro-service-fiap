import { useCallback, useEffect, useRef, useState } from 'react'
import { type AgentSession, api } from './api.js'

const CHAVE = 'sync.console.sessao'

export function useAgentSession() {
  const [sessao, setSessao] = useState<AgentSession | null>(() => {
    try {
      const cru = localStorage.getItem(CHAVE)
      return cru ? (JSON.parse(cru) as AgentSession) : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    try {
      if (sessao) localStorage.setItem(CHAVE, JSON.stringify(sessao))
      else localStorage.removeItem(CHAVE)
    } catch {
      // Armazenamento bloqueado. A sessão vive só nesta aba.
    }
  }, [sessao])

  const sair = useCallback(() => setSessao(null), [])

  const refreshRef = useRef<string | null>(sessao?.refreshToken ?? null)
  refreshRef.current = sessao?.refreshToken ?? null

  /**
   * Renova o acesso antes de ele vencer.
   *
   * O token dura 15 minutos. Sem isto, o console simplesmente parava depois
   * desse tempo e mostrava "sem conexão com o servidor", que era falso: o
   * servidor estava no ar e a sessão é que havia expirado. Renovar aos 12
   * minutos deixa três de folga para uma tentativa que falhe.
   */
  useEffect(() => {
    if (!sessao) return

    const timer = setInterval(
      async () => {
        const atual = refreshRef.current
        if (!atual) return
        try {
          const novo = await api.refresh(atual)
          setSessao((s) => (s ? { ...s, ...novo } : s))
        } catch {
          // Refresh recusado: a sessão acabou de verdade. Volta para a entrada.
          setSessao(null)
        }
      },
      12 * 60 * 1000,
    )

    return () => clearInterval(timer)
  }, [sessao])

  return { sessao, entrar: setSessao, sair }
}
