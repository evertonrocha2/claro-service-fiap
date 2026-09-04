import { ArrowUpRight, Headset, MessagesSquare } from 'lucide-react'

/**
 * Ponte entre o site do cliente e o console da equipe.
 *
 * Os dois rodam em endereços diferentes e, sem isto, não havia caminho de um para
 * o outro: quem abria um deles não descobria que o outro existia.
 *
 * Os endereços chegam por prop, não de import.meta.env, para o pacote não
 * depender do bundler de quem o usa. Cada aplicação passa o valor do próprio
 * ambiente, o que também serve em produção, onde serão domínios e não localhost.
 */
export type AppArea = 'site' | 'console'

export type AppSwitcherProps = {
  current: AppArea
  siteUrl?: string
  consoleUrl?: string
}

export function AppSwitcher({
  current,
  siteUrl = 'http://localhost:5173',
  consoleUrl = 'http://localhost:5174',
}: AppSwitcherProps) {
  const AREAS = [
    { id: 'site' as const, label: 'Atendimento ao cliente', icon: MessagesSquare, href: siteUrl },
    { id: 'console' as const, label: 'Console da equipe', icon: Headset, href: consoleUrl },
  ]

  return (
    <nav className="switcher" aria-label="Alternar entre áreas">
      {AREAS.map((area) => {
        const Icone = area.icon
        const aqui = area.id === current

        if (aqui) {
          return (
            <span key={area.id} className="switcher__item is-current" aria-current="page">
              <Icone size={15} strokeWidth={2} />
              <span>{area.label}</span>
            </span>
          )
        }

        return (
          <a key={area.id} className="switcher__item" href={area.href}>
            <Icone size={15} strokeWidth={2} />
            <span>{area.label}</span>
            <ArrowUpRight size={13} strokeWidth={2.5} className="switcher__out" />
          </a>
        )
      })}
    </nav>
  )
}
