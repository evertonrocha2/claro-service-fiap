import { useCallback, useEffect, useState } from 'react'
import type { AgentSession } from './api.js'

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

  return { sessao, entrar: setSessao, sair }
}
