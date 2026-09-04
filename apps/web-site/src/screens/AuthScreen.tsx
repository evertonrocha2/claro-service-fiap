import { ClaroLogo } from '@sync/chat-ui'
import { type FormEvent, useState } from 'react'
import { api, type Session, SyncApiError } from '../api.js'

type Modo = 'entrar' | 'primeiro-acesso'

export type AuthScreenProps = {
  onAuthenticated: (sessao: Session) => void
  onSkip: () => void
}

export function AuthScreen({ onAuthenticated, onSkip }: AuthScreenProps) {
  const [modo, setModo] = useState<Modo>('entrar')
  const [cpf, setCpf] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setAviso(null)
    setEnviando(true)

    try {
      if (modo === 'primeiro-acesso') {
        await api.firstAccess(cpf, email, senha)
        setAviso('Senha criada. Entre com ela agora.')
        setModo('entrar')
        setCpf('')
      } else {
        onAuthenticated(await api.login(email, senha))
      }
    } catch (e) {
      setErro(
        e instanceof SyncApiError ? e.message : 'Sem conexão com o servidor. Tente novamente.',
      )
    } finally {
      setEnviando(false)
    }
  }

  function trocarModo(novo: Modo) {
    setModo(novo)
    setErro(null)
    setAviso(null)
  }

  return (
    <div className="auth">
      <section className="auth__pitch">
        <span className="auth__logo">
          <ClaroLogo height={34} />
        </span>

        <h1 className="auth__headline">
          Comece aqui.
          <br />
          Termine onde quiser.
        </h1>

        <p className="auth__sub">
          Seu atendimento continua do mesmo ponto no site, no app ou no WhatsApp. Você não repete
          nada.
        </p>

        <ol className="auth__steps">
          <li>
            <div>
              <span>Site</span> Você descreve o problema
            </div>
          </li>
          <li>
            <div>
              <span>WhatsApp</span> A conversa continua do mesmo ponto
            </div>
          </li>
          <li>
            <div>
              <span>Atendente</span> Recebe o histórico completo
            </div>
          </li>
        </ol>
      </section>

      <section className="auth__panel">
        <form className="auth__form" onSubmit={enviar}>
          <h2 className="auth__title">
            {modo === 'entrar' ? 'Entrar na sua conta' : 'Criar sua senha'}
          </h2>
          <p className="auth__hint">
            {modo === 'entrar'
              ? 'Use o e-mail cadastrado na Claro.'
              : 'Confirme o CPF e o e-mail do seu cadastro para definir a senha.'}
          </p>

          {modo === 'primeiro-acesso' && (
            <label className="field">
              CPF
              <input
                type="text"
                inputMode="numeric"
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                placeholder="000.000.000-00"
                autoComplete="off"
                required
              />
            </label>
          )}

          <label className="field">
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@exemplo.com"
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
              placeholder={modo === 'entrar' ? 'Sua senha' : 'Ao menos 8 caracteres'}
              autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
              minLength={modo === 'entrar' ? undefined : 8}
              required
            />
          </label>

          {erro && (
            <p className="alert alert--error" role="alert">
              {erro}
            </p>
          )}
          {aviso && (
            <p className="alert alert--ok" role="status">
              {aviso}
            </p>
          )}

          <button className="btn btn--primary" type="submit" disabled={enviando}>
            {enviando ? 'Aguarde…' : modo === 'entrar' ? 'Entrar' : 'Criar senha'}
          </button>

          <button
            className="btn btn--link"
            type="button"
            onClick={() => trocarModo(modo === 'entrar' ? 'primeiro-acesso' : 'entrar')}
          >
            {modo === 'entrar' ? 'Primeiro acesso? Crie sua senha' : 'Já tenho senha'}
          </button>

          <div className="auth__divider">
            <span>ou</span>
          </div>

          <button className="btn btn--ghost" type="button" onClick={onSkip}>
            Continuar sem identificação
          </button>

          {/* Nao existe cadastro aberto: a base de clientes vem semeada, porque
              uma conta criada do zero nao teria plano nem fatura sobre o que
              conversar. Sem esta lista quem abre a tela tenta o proprio CPF e
              leva "nao encontramos um cadastro", que esta correto e parece bug. */}
          <div className="auth__demo">
            <strong className="auth__demo-title">Contas desta demonstração</strong>

            <dl className="auth__demo-list">
              <dt>Maria Silva</dt>
              <dd>
                CPF 123.456.789-00
                <span>maria.silva@exemplo.com</span>
              </dd>

              <dt>João Pereira</dt>
              <dd>
                CPF 987.654.321-00
                <span>joao.pereira@exemplo.com</span>
              </dd>
            </dl>

            <p className="auth__demo-note">No primeiro acesso você define a senha.</p>
          </div>
        </form>
      </section>
    </div>
  )
}
