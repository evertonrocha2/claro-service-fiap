import { useEffect, useState } from 'react'

/**
 * Rota por hash, e não por caminho.
 *
 * A página do atendimento precisa de endereço próprio para abrir em outra aba e
 * sobreviver a um F5. Com caminho de verdade (`/atendimento/<id>`) qualquer
 * servidor estático devolve 404 nesse endereço até ser configurado para
 * reescrever tudo no index.html, e este console é servido de formas diferentes
 * em desenvolvimento e na apresentação.
 *
 * Com hash o navegador nunca pede aquele caminho ao servidor. Custa um `#` na
 * barra e economiza uma configuração que quebra em silêncio.
 */
const PREFIXO = '#/atendimento/'

export function ticketHref(id: string): string {
  return `${PREFIXO}${encodeURIComponent(id)}`
}

function lerRota(): string | null {
  const hash = window.location.hash
  if (!hash.startsWith(PREFIXO)) return null

  const id = decodeURIComponent(hash.slice(PREFIXO.length))
  return id.length > 0 ? id : null
}

/** Id do atendimento em foco, ou null quando a aba está no console normal. */
export function useTicketRoute(): string | null {
  const [id, setId] = useState<string | null>(lerRota)

  useEffect(() => {
    const aoTrocar = () => setId(lerRota())
    window.addEventListener('hashchange', aoTrocar)
    return () => window.removeEventListener('hashchange', aoTrocar)
  }, [])

  return id
}
