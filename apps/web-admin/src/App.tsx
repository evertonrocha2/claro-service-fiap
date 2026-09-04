import { useCallback, useEffect, useState } from 'react'
import { type ConversationDetail, type Metrics, type QueueItem, api } from './api.js'
import { AgentLogin } from './screens/AgentLogin.js'
import { Board } from './screens/Board.js'
import { Detail, EmptyDetail } from './screens/Detail.js'
import { History } from './screens/History.js'
import { Pulse } from './screens/Pulse.js'
import { useAgentSession } from './useAgentSession.js'

type Aba = 'quadro' | 'historico'

/**
 * A fila muda porque clientes chegam, não porque este atendente fez algo. Sem
 * atualizar sozinho, o console mentiria em silêncio a cada minuto parado.
 * Cinco segundos é curto o bastante para parecer vivo e longo o bastante para
 * não pesar no banco.
 */
const INTERVALO_MS = 5000

export function App() {
  const { sessao, entrar, sair } = useAgentSession()
  const [aba, setAba] = useState<Aba>('quadro')
  const [fila, setFila] = useState<QueueItem[]>([])
  const [resolvidos, setResolvidos] = useState<QueueItem[]>([])
  const [metricas, setMetricas] = useState<Metrics | null>(null)
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [detalhe, setDetalhe] = useState<ConversationDetail | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const token = sessao?.accessToken ?? null

  const carregar = useCallback(async () => {
    if (!token) return
    try {
      const [ativos, encerrados, m] = await Promise.all([
        api.queue(token),
        api.queue(token, { status: 'RESOLVED' }),
        api.metrics(token),
      ])
      setFila(ativos)
      setResolvidos(encerrados)
      setMetricas(m)
      setErro(null)
    } catch {
      setErro('Perdemos contato com o servidor. Tentando de novo.')
    }
  }, [token])

  const carregarDetalhe = useCallback(
    async (id: string) => {
      if (!token) return
      try {
        setDetalhe(await api.detail(token, id))
      } catch {
        setDetalhe(null)
      }
    },
    [token],
  )

  useEffect(() => {
    if (!token) return
    void carregar()
    const timer = setInterval(() => void carregar(), INTERVALO_MS)
    return () => clearInterval(timer)
  }, [token, carregar])

  useEffect(() => {
    if (selecionado) void carregarDetalhe(selecionado)
    else setDetalhe(null)
  }, [selecionado, carregarDetalhe, fila])

  if (!sessao || !token) {
    return <AgentLogin onEntrar={entrar} />
  }

  function escolher(id: string) {
    setSelecionado(id)
  }

  async function aposMudanca() {
    await carregar()
    if (selecionado) await carregarDetalhe(selecionado)
  }

  return (
    <div className="shell">
      <header className="bar">
        <div className="bar__brand">
          <span className="bar__mark" aria-hidden="true" />
          claro
        </div>
        <span className="bar__where">Console de atendimento</span>

        <nav className="bar__tabs">
          <button
            type="button"
            className="tab"
            aria-current={aba === 'quadro'}
            onClick={() => setAba('quadro')}
          >
            Quadro
          </button>
          <button
            type="button"
            className="tab"
            aria-current={aba === 'historico'}
            onClick={() => setAba('historico')}
          >
            Histórico
          </button>
        </nav>

        <div className="bar__right">
          {erro && <span className="notice notice--error">{erro}</span>}
          <span className="bar__who">{sessao.agent.name}</span>
          <span className="bar__role">
            {sessao.agent.role === 'MANAGER' ? 'Gestão' : 'Atendimento'}
          </span>
          <button className="linkish" type="button" onClick={sair}>
            Sair
          </button>
        </div>
      </header>

      <Pulse metrics={metricas} />

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {aba === 'quadro' ? (
          <Board items={fila} selectedId={selecionado} onSelect={escolher} />
        ) : (
          <History items={resolvidos} onSelect={escolher} />
        )}

        {detalhe ? (
          <Detail
            token={token}
            detail={detalhe}
            agentId={sessao.agent.id}
            onChanged={aposMudanca}
          />
        ) : (
          <EmptyDetail />
        )}
      </div>
    </div>
  )
}
