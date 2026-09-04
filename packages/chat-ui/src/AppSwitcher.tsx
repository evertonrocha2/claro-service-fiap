import { ArrowUpRight, MessagesSquare } from 'lucide-react'

/**
 * Link do console para o site do cliente.
 *
 * Uma via só, e de propósito. A versão anterior era um seletor de duas vias que
 * aparecia nas duas aplicações, então o cliente via um caminho para a ferramenta
 * interna da Claro na própria tela de atendimento. A equipe conferir o que o
 * cliente vê é legítimo; o contrário não é.
 *
 * O endereço chega por prop, não de import.meta.env, para o pacote não depender
 * do bundler de quem o usa.
 */
export function CustomerSiteLink({ href = 'http://localhost:5173' }: { href?: string }) {
  return (
    <a className="site-link" href={href} target="_blank" rel="noreferrer">
      <MessagesSquare size={15} strokeWidth={2} />
      <span>Ver site do cliente</span>
      <ArrowUpRight size={13} strokeWidth={2.5} className="site-link__out" />
    </a>
  )
}
