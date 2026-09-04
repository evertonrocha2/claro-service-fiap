import { Check, CheckCheck, Phone, Send, Video } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { api, type Mensagem } from './api.js'

const CHAVE_TELEFONE = 'sync.zap.telefone'
const CHAVE_CONVERSA = 'sync.zap.conversa'
const INTERVALO_MS = 4000

function guardar(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor)
  } catch {
    // Armazenamento bloqueado. A sessão vive só nesta aba.
  }
}

function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave)
  } catch {
    return null
  }
}

/**
 * WhatsApp simulado.
 *
 * É a "WhatsApp Business API simulada" da Documentação Técnica. A tela imita o
 * aplicativo, mas por baixo é apenas mais um cliente da mesma API: manda a
 * mensagem com channel WHATSAPP e o telefone, e lê a conversa de volta pelo
 * mesmo endereço que o site usa.
 *
 * O backend não sabe que isto é falso, e é justamente esse o teste: quando a
 * Meta entrar, muda o adaptador de entrada e nada mais.
 *
 * ESTA TELA MOSTRA SÓ O QUE PASSOU PELO WHATSAPP.
 *
 * O atendente não troca de ferramenta: ele continua no console do Sync, que
 * mostra site e WhatsApp na mesma conversa, e é dali que ele responde. É o modelo
 * de caixa de entrada unificada, tipo ManyChat. O contexto viaja pelo sistema,
 * não pela tela do cliente.
 *
 * Então o histórico do site não aparece aqui, e não deveria: no WhatsApp de
 * verdade a pessoa vê a conversa do WhatsApp. Trazer o que ela digitou no site
 * para dentro desta janela não acontece no mundo real e faria a demonstração
 * mentir sobre onde a continuidade mora.
 */
export function App() {
  const [telefone, setTelefone] = useState(() => ler(CHAVE_TELEFONE) ?? '')
  const [confirmado, setConfirmado] = useState(() => ler(CHAVE_TELEFONE) !== null)
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const conversaRef = useRef<string | null>(ler(CHAVE_CONVERSA))
  const fim = useRef<HTMLDivElement>(null)

  // O link de continuidade abre esta tela com a mensagem pronta na URL. É o que
  // amarra a conversa do site a esta, e some da barra depois de lida.
  useEffect(() => {
    const vinda = new URLSearchParams(window.location.search).get('text')
    if (vinda) {
      setTexto(vinda)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const sincronizar = useCallback(async () => {
    const id = conversaRef.current
    if (!id) return
    try {
      const conversa = await api.load(id)
      // A conversa vem inteira, porque e uma so no banco. O recorte e daqui:
      // esta janela e o WhatsApp do cliente, nao o painel do atendente.
      setMensagens(conversa.messages.filter((m) => m.channel === 'WHATSAPP'))
    } catch {
      conversaRef.current = null
    }
  }, [])

  useEffect(() => {
    void sincronizar()
    const timer = setInterval(() => void sincronizar(), INTERVALO_MS)
    return () => clearInterval(timer)
  }, [sincronizar])

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' })
  }, [mensagens.length])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const corpo = texto.trim()
    if (corpo.length === 0 || enviando) return

    setErro(null)
    setEnviando(true)
    setTexto('')

    try {
      const r = await api.send(corpo, telefone, conversaRef.current)
      conversaRef.current = r.conversationId
      guardar(CHAVE_CONVERSA, r.conversationId)
      await sincronizar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar.')
      setTexto(corpo)
    } finally {
      setEnviando(false)
    }
  }

  if (!confirmado) {
    return (
      <div className="setup">
        <form
          className="setup__card"
          onSubmit={(e) => {
            e.preventDefault()
            if (telefone.trim().length < 8) return
            guardar(CHAVE_TELEFONE, telefone.trim())
            setConfirmado(true)
          }}
        >
          <span className="setup__badge">Simulação</span>
          <h1 className="setup__title">WhatsApp do cliente</h1>
          <p className="setup__hint">
            Esta tela representa o WhatsApp da pessoa. Informe o número dela para que o Sync
            reconheça de quem é a conversa, como a Meta faria ao entregar a mensagem.
          </p>

          <label className="setup__field">
            Telefone com DDD
            <input
              type="tel"
              inputMode="tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="(11) 98765-4321"
              autoComplete="tel"
            />
          </label>

          <button className="setup__go" type="submit">
            Abrir conversa
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="zap">
      <header className="zap__bar">
        <span className="zap__avatar" aria-hidden="true">
          C
        </span>
        <span className="zap__who">
          <strong>Claro</strong>
          <small>conta comercial</small>
        </span>
        <span className="zap__icons" aria-hidden="true">
          <Video size={18} strokeWidth={2} />
          <Phone size={17} strokeWidth={2} />
        </span>
      </header>

      <div className="zap__thread">
        {/* A pilha existe para as mensagens assentarem embaixo, como no
            aplicativo. Empurrar com justify-content no contentor que rola corta
            o topo quando a conversa passa da altura da tela. */}
        <div className="zap__stack">
          <p className="zap__notice">
            As mensagens são protegidas com criptografia de ponta a ponta. Simulação para
            demonstração do Sync.
          </p>

          {mensagens.map((m) => (
            <div
              key={m.id}
              className={`zap__msg ${m.sender === 'CUSTOMER' ? 'zap__msg--mine' : 'zap__msg--theirs'}`}
            >
              {m.sender === 'AGENT' && <span className="zap__sender">Atendente</span>}
              {m.text}
              {m.sender === 'CUSTOMER' && (
                <span className="zap__ticks" aria-hidden="true">
                  <CheckCheck size={14} strokeWidth={2.5} />
                </span>
              )}
            </div>
          ))}

          {enviando && (
            <div className="zap__msg zap__msg--mine zap__msg--pending">
              enviando
              <span className="zap__ticks" aria-hidden="true">
                <Check size={14} strokeWidth={2.5} />
              </span>
            </div>
          )}

          <div ref={fim} />
        </div>
      </div>

      {erro && <p className="zap__error">{erro}</p>}

      <form className="zap__composer" onSubmit={enviar}>
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Mensagem"
          aria-label="Mensagem"
        />
        <button type="submit" aria-label="Enviar" disabled={texto.trim().length === 0}>
          <Send size={17} strokeWidth={2} />
        </button>
      </form>
    </div>
  )
}
