import { type FormEvent, useState } from 'react'
import { type AgentSession, ConsoleError, api } from '../api.js'

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
      setErro(e instanceof ConsoleError ? e.message : 'Não conseguimos falar com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="signin">
      <form className="signin__card" onSubmit={enviar}>
        <div className="bar__brand">
          <span className="bar__mark" aria-hidden="true" />
          claro
        </div>

        <h1 className="signin__title">Console de atendimento</h1>
        <p className="signin__hint">Entre com seu e-mail da equipe.</p>

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
