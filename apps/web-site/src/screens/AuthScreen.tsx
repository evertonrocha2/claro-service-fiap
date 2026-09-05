import { ClaroLogo } from '@sync/chat-ui'
import { type FormEvent, useState } from 'react'
import { api, type Session, SyncApiError } from '../api.js'

/**
 * Quatro modos, e a recuperação são dois deles.
 *
 * Existia a mensagem "esta conta já tem senha, use a opção de recuperação" e a
 * opção não existia. Quem fizesse o primeiro acesso e esquecesse a senha ficava
 * sem conta, porque o primeiro acesso se recusa a sobrescrever uma senha
 * definida, e com razão: se sobrescrevesse, saber CPF e e-mail bastaria para
 * tomar a conta de alguém.
 */
type Modo = 'entrar' | 'primeiro-acesso' | 'recuperar' | 'novo-codigo'

const TITULOS: Record<Modo, string> = {
  entrar: 'Entrar na sua conta',
  'primeiro-acesso': 'Criar sua senha',
  recuperar: 'Recuperar o acesso',
  'novo-codigo': 'Definir a nova senha',
}

const AJUDAS: Record<Modo, string> = {
  entrar: 'Use o e-mail cadastrado na Claro.',
  'primeiro-acesso': 'Confirme o CPF e o e-mail do seu cadastro para definir a senha.',
  recuperar: 'Informe o CPF e o e-mail do cadastro. Enviaremos um código de verificação.',
  'novo-codigo': 'Digite o código que você recebeu e escolha a nova senha.',
}

const ACOES: Record<Modo, string> = {
  entrar: 'Entrar',
  'primeiro-acesso': 'Criar senha',
  recuperar: 'Enviar código',
  'novo-codigo': 'Salvar nova senha',
}

export type AuthScreenProps = {
  onAuthenticated: (sessao: Session) => void
  onSkip: () => void
}

export function AuthScreen({ onAuthenticated, onSkip }: AuthScreenProps) {
  const [modo, setModo] = useState<Modo>('entrar')
  const [cpf, setCpf] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const pedeCpf = modo === 'primeiro-acesso' || modo === 'recuperar'
  const pedeEmail = modo !== 'novo-codigo'
  const pedeSenha = modo !== 'recuperar'

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
        return
      }

      if (modo === 'recuperar') {
        const r = await api.requestPasswordReset(cpf, email)
        setModo('novo-codigo')
        setSenha('')

        // O código chega pré-preenchido porque este MVP não tem remetente de
        // e-mail. Fora de desenvolvimento o campo volta vazio e a pessoa digita
        // o que recebeu, sem mudança nenhuma nesta tela.
        if (r.devCode) {
          setCodigo(r.devCode)
          setAviso(
            `Ambiente de demonstração: não há envio de e-mail, então o código é ${r.devCode}.`,
          )
        } else {
          setAviso('Se o cadastro existir, o código chegará no e-mail informado.')
        }
        return
      }

      if (modo === 'novo-codigo') {
        await api.confirmPasswordReset(codigo, senha)
        setAviso('Senha alterada. Entre com a nova senha.')
        setModo('entrar')
        setCodigo('')
        setCpf('')
        setSenha('')
        return
      }

      onAuthenticated(await api.login(email, senha))
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
          <h2 className="auth__title">{TITULOS[modo]}</h2>
          <p className="auth__hint">{AJUDAS[modo]}</p>

          {pedeCpf && (
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

          {pedeEmail && (
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
          )}

          {modo === 'novo-codigo' && (
            <label className="field">
              Código de verificação
              <input
                type="text"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                placeholder="8 caracteres"
                autoComplete="one-time-code"
                className="field__code"
                required
              />
            </label>
          )}

          {pedeSenha && (
            <label className="field">
              {modo === 'novo-codigo' ? 'Nova senha' : 'Senha'}
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
          )}

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
            {enviando ? 'Aguarde…' : ACOES[modo]}
          </button>

          {/* Os dois caminhos alternativos ficam visíveis ao mesmo tempo na tela
              de entrada. Escondidos atrás de um único link, quem esqueceu a
              senha caía no primeiro acesso e levava um erro. */}
          <div className="auth__links">
            {modo === 'entrar' ? (
              <>
                <button
                  className="btn btn--link"
                  type="button"
                  onClick={() => trocarModo('primeiro-acesso')}
                >
                  Primeiro acesso? Crie sua senha
                </button>
                <button
                  className="btn btn--link"
                  type="button"
                  onClick={() => trocarModo('recuperar')}
                >
                  Esqueci minha senha
                </button>
              </>
            ) : (
              <button className="btn btn--link" type="button" onClick={() => trocarModo('entrar')}>
                Já tenho senha
              </button>
            )}
          </div>

          <div className="auth__divider">
            <span>ou</span>
          </div>

          <button className="btn btn--ghost" type="button" onClick={onSkip}>
            Continuar sem identificação
          </button>

          {/* Nao existe cadastro aberto: a base de clientes pertence a Claro, e
              uma conta criada do zero nao teria plano nem fatura sobre o que
              conversar. Sem esta indicacao, quem abre a tela tenta o proprio CPF
              e leva "nao encontramos um cadastro", que esta correto e parece
              defeito. */}
          <div className="auth__demo">
            <strong className="auth__demo-title">Conta desta demonstração</strong>

            <dl className="auth__demo-list">
              <dt>Maria Silva</dt>
              <dd>
                CPF 123.456.789-00
                <span>maria.silva@exemplo.com</span>
              </dd>
            </dl>

            <p className="auth__demo-note">
              No primeiro acesso você define a senha. Se esquecer, use "Esqueci minha senha".
            </p>
          </div>
        </form>
      </section>
    </div>
  )
}
