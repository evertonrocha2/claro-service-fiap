import { ClaroLogo } from '@sync/chat-ui'
import { type FormEvent, useState } from 'react'
import { type AgentSession, api, ConsoleError } from '../api.js'

export function AgentLogin({ onEntrar }: { onEntrar: (s: AgentSession) => void }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      onEntrar(await api.login(email, senha))
    } catch (e) {
      setErro(
        e instanceof ConsoleError ? e.message : 'Sem conexão com o servidor. Tente novamente.',
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="signin">
      <form className="signin__card" onSubmit={enviar}>
        <span className="signin__logo">
          <ClaroLogo height={26} />
        </span>

        <h1 className="signin__title">Console de Atendimento</h1>
        <p className="signin__hint">Acesso restrito à equipe de atendimento da Claro.</p>

        <label className="field">
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@claro.com.br"
            autoComplete="email"
            required
          />
        </label>

        <label className="field">
          Senha
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {erro && (
          <p className="notice notice--error" role="alert">
            {erro}
          </p>
        )}

        <button className="btn btn--primary" type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
