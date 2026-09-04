import { AppSwitcher, ClaroLogo } from '@sync/chat-ui'
import { History as HistoryIcon, Inbox, LogOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type ConversationDetail, type Metrics, type QueueItem } from './api.js'
import { AgentLogin } from './screens/AgentLogin.js'
import { Board } from './screens/Board.js'
import { Detail, EmptyDetail } from './screens/Detail.js'
import {
  aplicarFiltros,
  FILTRO_VAZIO,
  type FilterState,
  Filters,
  filtrosAtivos,
} from './screens/Filters.js'
import { History } from './screens/History.js'
import { Pulse } from './screens/Pulse.js'
import { useAgentSession } from './useAgentSession.js'

type Aba = 'fila' | 'historico'

/**
 * A fila muda porque clientes chegam, não porque este atendente fez algo. Sem
 * atualizar sozinho, o console mentiria em silêncio a cada minuto parado.
 */
const INTERVALO_MS = 5000

export function App() {
  const { sessao, entrar, sair } = useAgentSession()
  const [aba, setAba] = useState<Aba>('fila')
  const [fila, setFila] = useState<QueueItem[]>([])
  const [encerrados, setEncerrados] = useState<QueueItem[]>([])
  const [metricas, setMetricas] = useState<Metrics | null>(null)
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [detalhe, setDetalhe] = useState<ConversationDetail | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [filtros, setFiltros] = useState<FilterState>(FILTRO_VAZIO)

  const token = sessao?.accessToken ?? null
  const aberto = selecionado

  const carregar = useCallback(async () => {
    if (!token) return
    try {
      const [ativos, resolvidos, m] = await Promise.all([
        api.queue(token),
        api.queue(token, { status: 'RESOLVED' }),
        api.metrics(token),
      ])
      setFila(ativos)
      setEncerrados(resolvidos)
      setMetricas(m)
      setErro(null)

      // O detalhe aberto entra no mesmo ciclo: se outro atendente assumir ou
      // encerrar o caso, a tela precisa refletir isso sem depender de clique.
      if (aberto) {
        try {
          setDetalhe(await api.detail(token, aberto))
        } catch {
          setDetalhe(null)
        }
      }
    } catch {
      setErro('Sem conexão com o servidor. Nova tentativa em instantes.')
    }
  }, [token, aberto])

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
  }, [selecionado, carregarDetalhe])

  // Trocar de aba zera o filtro: os critérios da fila não fazem sentido no
  // histórico, e um filtro invisível herdado esconderia registros sem explicação.
  function trocarAba(nova: Aba) {
    setAba(nova)
    setFiltros(FILTRO_VAZIO)
  }

  const base = aba === 'fila' ? fila : encerrados
  const visiveis = useMemo(() => aplicarFiltros(base, filtros), [base, filtros])

  if (!sessao || !token) {
    return <AgentLogin onEntrar={entrar} />
  }

  async function aposMudanca() {
    await carregar()
    if (selecionado) await carregarDetalhe(selecionado)
  }

  return (
    <div className="shell">
      <header className="bar">
        <span className="bar__logo">
          <ClaroLogo height={20} />
        </span>
        <span className="bar__where">Console de Atendimento</span>

        <AppSwitcher current="console" />

        <div className="bar__right">
          {erro && <span className="notice notice--error">{erro}</span>}
          <span className="bar__identity">
            <span className="bar__who">{sessao.agent.name}</span>
            <span className="bar__role">
              {sessao.agent.role === 'MANAGER' ? 'Gestão' : 'Atendimento'}
            </span>
          </span>
          <button className="linkish" type="button" onClick={sair}>
            <LogOut size={14} strokeWidth={2} />
            Sair
          </button>
        </div>
      </header>

      <Pulse metrics={metricas} />

      <div className="toolbar">
        <nav className="nav" aria-label="Seções do console">
          <button
            type="button"
            className="nav__item"
            aria-current={aba === 'fila'}
            onClick={() => trocarAba('fila')}
          >
            <Inbox size={15} strokeWidth={2} />
            Fila de atendimento
            <span className="nav__badge">{fila.length}</span>
          </button>
          <button
            type="button"
            className="nav__item"
            aria-current={aba === 'historico'}
            onClick={() => trocarAba('historico')}
          >
            <HistoryIcon size={15} strokeWidth={2} />
            Histórico
            <span className="nav__badge">{encerrados.length}</span>
          </button>
        </nav>

        <Filters
          value={filtros}
          onChange={setFiltros}
          showing={visiveis.length}
          total={base.length}
          withStatus={aba === 'fila'}
        />
      </div>

      <div className="workarea">
        {aba === 'fila' ? (
          <Board items={visiveis} selectedId={selecionado} onSelect={setSelecionado} />
        ) : (
          <History
            items={visiveis}
            selectedId={selecionado}
            onSelect={setSelecionado}
            filtered={filtrosAtivos(filtros)}
          />
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
