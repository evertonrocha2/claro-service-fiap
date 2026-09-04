import { useCallback, useEffect, useState } from 'react'
import { type Session, api } from './api.js'

const CHAVE = 'sync.sessao'

/**
 * Sessão do cliente guardada no localStorage.
 *
 * O refresh token fica aqui junto com o access. Não é o ideal para produção, onde
 * ele deveria vir em cookie httpOnly, mas o MVP roda site e API em origens
 * separadas no desenvolvimento e o cookie complicaria sem ganho de aprendizado.
 * Está anotado como dívida consciente, não como esquecimento.
 */
export function useSession() {
  const [sessao, setSessao] = useState<Session | null>(() => {
    try {
      const cru = localStorage.getItem(CHAVE)
      return cru ? (JSON.parse(cru) as Session) : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    try {
      if (sessao) localStorage.setItem(CHAVE, JSON.stringify(sessao))
      else localStorage.removeItem(CHAVE)
    } catch {
      // Navegador com armazenamento bloqueado. A sessão vive só nesta aba.
    }
  }, [sessao])

  const sair = useCallback(async () => {
    const atual = sessao
    setSessao(null)
    if (atual) await api.logout(atual.refreshToken).catch(() => undefined)
  }, [sessao])

  return { sessao, entrar: setSessao, sair }
}
