import { useState } from 'react'
import { AuthScreen } from './screens/AuthScreen.js'
import { ChatScreen } from './screens/ChatScreen.js'
import { useSession } from './useSession.js'

export function App() {
  const { sessao, entrar, sair } = useSession()
  // Quem já entrou vai direto para o chat. Quem escolheu "falar sem entrar"
  // também: o RF002 resolve a identificação por CPF dentro da conversa.
  const [mostrandoChat, setMostrandoChat] = useState(false)

  if (!sessao && !mostrandoChat) {
    return (
      <AuthScreen
        onAuthenticated={(nova) => {
          entrar(nova)
          setMostrandoChat(true)
        }}
        onSkip={() => setMostrandoChat(true)}
      />
    )
  }

  return (
    <ChatScreen
      sessao={sessao}
      onSair={async () => {
        await sair()
        setMostrandoChat(false)
      }}
      onEntrar={() => setMostrandoChat(false)}
    />
  )
}
