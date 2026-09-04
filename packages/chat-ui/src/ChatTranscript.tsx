import { useEffect, useRef } from 'react'
import type { ChatMessage } from './types.js'

const QUEM: Record<ChatMessage['role'], string | null> = {
  CUSTOMER: null,
  BOT: 'Sync',
  AGENT: 'Atendente',
}

export type ChatTranscriptProps = {
  messages: ChatMessage[]
  waiting: boolean
  emptyMessage: string
}

export function ChatTranscript({ messages, waiting, emptyMessage }: ChatTranscriptProps) {
  const fim = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' })
  }, [])

  if (messages.length === 0 && !waiting) {
    return (
      <div className="sync-transcript">
        <p className="sync-empty">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="sync-transcript" role="log" aria-live="polite" aria-label="Conversa">
      {messages.map((m) => {
        const quem = QUEM[m.role]
        return (
          <div key={m.id} className={`sync-bubble sync-bubble--${m.role.toLowerCase()}`}>
            {quem && <span className="sync-bubble__who">{quem}</span>}
            {m.text}
          </div>
        )
      })}

      {waiting && (
        <div className="sync-typing" aria-label="Sync está escrevendo">
          <span />
          <span />
          <span />
        </div>
      )}

      <div ref={fim} />
    </div>
  )
}
