import { LogIn, LogOut, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { type AppArea, AppSwitcher } from './AppSwitcher.js'
import { ClaroLogo } from './ClaroLogo.js'

export type AppHeaderIdentity = {
  name: string
  /** Cargo, no console. O site não tem, e a linha simplesmente não aparece. */
  role?: string
}

export type AppHeaderProps = {
  area: AppArea
  title: string
  identity?: AppHeaderIdentity
  onSignOut?: () => void
  onSignIn?: () => void
  siteUrl?: string
  consoleUrl?: string
  /** Conteúdo extra à direita, como um aviso de estado. */
  aside?: ReactNode
}

/**
 * Cabeçalho comum ao site e ao console.
 *
 * Era o mesmo desenho escrito duas vezes, e as duas cópias já divergiam: a marca
 * saía em tamanhos diferentes e a barra tinha alturas diferentes, então trocar de
 * área dava um solavanco. Um componente só elimina a chance de divergirem de novo.
 */
export function AppHeader({
  area,
  title,
  identity,
  onSignOut,
  onSignIn,
  siteUrl,
  consoleUrl,
  aside,
}: AppHeaderProps) {
  return (
    <header className="appbar">
      <span className="appbar__logo">
        <ClaroLogo height={22} />
      </span>

      <span className="appbar__title">{title}</span>

      <AppSwitcher current={area} siteUrl={siteUrl} consoleUrl={consoleUrl} />

      <div className="appbar__right">
        {aside}

        {identity ? (
          <>
            <span className="appbar__identity">
              <UserRound size={15} strokeWidth={2} aria-hidden="true" />
              <span className="appbar__identity-text">
                <span className="appbar__name">{identity.name}</span>
                {identity.role && <span className="appbar__role">{identity.role}</span>}
              </span>
            </span>

            {onSignOut && (
              <button className="appbar__action" type="button" onClick={onSignOut}>
                <LogOut size={14} strokeWidth={2} />
                Sair
              </button>
            )}
          </>
        ) : (
          onSignIn && (
            <button className="appbar__action" type="button" onClick={onSignIn}>
              <LogIn size={14} strokeWidth={2} />
              Entrar
            </button>
          )
        )}
      </div>
    </header>
  )
}
