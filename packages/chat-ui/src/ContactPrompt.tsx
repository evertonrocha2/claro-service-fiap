import { MessageCircleMore, Phone } from 'lucide-react'
import { type FormEvent, useState } from 'react'

export type ContactPromptProps = {
  onSubmit: (phone: string) => Promise<void>
  onSkip: () => void
  error?: string | null
}

/**
 * Pede o telefone no começo do atendimento.
 *
 * É o que permite continuar no WhatsApp depois. Sem o número, uma conversa
 * anônima do site não tem como ser reconhecida quando a pessoa escreve de lá, e
 * o atendimento recomeça do zero, que é justamente o problema que o Sync existe
 * para resolver.
 *
 * Dá para recusar. Cobrar o dado antes de qualquer ajuda transformaria o
 * atendimento em cadastro, e quem só quer o código de barras da fatura não
 * deveria passar por isso.
 */
export function ContactPrompt({ onSubmit, onSkip, error }: ContactPromptProps) {
  const [telefone, setTelefone] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (telefone.trim().length < 8) return
    setEnviando(true)
    try {
      await onSubmit(telefone.trim())
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="contact" onSubmit={enviar}>
      <span className="contact__icon" aria-hidden="true">
        <MessageCircleMore size={17} strokeWidth={2} />
      </span>

      <div className="contact__text">
        <h2 className="contact__title">Quer continuar no WhatsApp depois?</h2>
        <p className="contact__hint">
          Informe seu telefone e retomamos o atendimento de onde parou, sem repetir nada.
        </p>
      </div>

      <div className="contact__field">
        <Phone className="contact__field-icon" size={15} strokeWidth={2} aria-hidden="true" />
        <input
          type="tel"
          inputMode="tel"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          placeholder="(11) 98765-4321"
          aria-label="Seu telefone com DDD"
          autoComplete="tel"
        />
      </div>

      <button className="contact__save" type="submit" disabled={enviando}>
        {enviando ? 'Salvando' : 'Salvar'}
      </button>

      <button className="contact__skip" type="button" onClick={onSkip}>
        Agora não
      </button>

      {error && (
        <p className="contact__error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
