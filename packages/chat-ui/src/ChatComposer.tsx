import { type FormEvent, type KeyboardEvent, useState } from 'react'

export type ChatComposerProps = {
  onSend: (text: string) => void
  disabled: boolean
  placeholder: string
}

export function ChatComposer({ onSend, disabled, placeholder }: ChatComposerProps) {
  const [texto, setTexto] = useState('')
  const podeEnviar = texto.trim().length > 0 && !disabled

  function enviar(e?: FormEvent) {
    e?.preventDefault()
    if (!podeEnviar) return
    onSend(texto.trim())
    setTexto('')
  }

  // Enter envia, Shift+Enter quebra linha. É o que o WhatsApp faz, e a maior
  // parte de quem usa isso vem de lá.
  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  return (
    <form className="sync-composer" onSubmit={enviar}>
      <textarea
        className="sync-composer__input"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={aoTeclar}
        placeholder={placeholder}
        rows={1}
        aria-label="Sua mensagem"
        disabled={disabled}
      />
      <button
        className="sync-composer__send"
        type="submit"
        disabled={!podeEnviar}
        aria-label="Enviar mensagem"
      >
        ↑
      </button>
    </form>
  )
}
