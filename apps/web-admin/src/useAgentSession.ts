import { useCallback, useEffect, useRef, useState } from 'react'
import { type AgentSession, api, registrarRenovacao } from './api.js'

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

  /**
   * Uma aba avisa as outras quando a sessao muda.
   *
   * Sem isto, abrir um atendimento em outra aba derrubava as duas. O refresh
   * token gira a cada uso e o servidor detecta reuso como roubo: a aba B ainda
   * segurava o token que a aba A ja tinha gastado, e ao usa-lo a familia
   * inteira era revogada. Ouvir o storage mantem as abas no mesmo token.
   */
  useEffect(() => {
    const aoMudar = (e: StorageEvent) => {
      if (e.key !== CHAVE) return
      try {
        setSessao(e.newValue ? (JSON.parse(e.newValue) as AgentSession) : null)
      } catch {
        setSessao(null)
      }
    }

    window.addEventListener('storage', aoMudar)
    return () => window.removeEventListener('storage', aoMudar)
  }, [])

  const sair = useCallback(() => setSessao(null), [])

  const refreshRef = useRef<string | null>(sessao?.refreshToken ?? null)
  refreshRef.current = sessao?.refreshToken ?? null

  /**
   * Entrega ao cliente de API uma forma de renovar quando algo voltar 401.
   *
   * Sem isto, a única renovação era a do temporizador. Se a máquina dormisse ou
   * a aba ficasse em segundo plano além dos quinze minutos, o console parava e
   * culpava a conexão.
   */
  useEffect(() => {
    registrarRenovacao(async () => {
      const atual = refreshRef.current
      if (!atual) return null

      try {
        const novo = await api.refresh(atual)
        refreshRef.current = novo.refreshToken
        setSessao((s) => (s ? { ...s, ...novo } : s))
        return novo.accessToken
      } catch {
        setSessao(null)
        return null
      }
    })

    return () => registrarRenovacao(null)
  }, [])

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
