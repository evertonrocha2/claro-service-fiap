import { AppHeader } from '@sync/chat-ui'
import { History as HistoryIcon, Inbox, User, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type AgentPerformance,
  api,
  ConsoleError,
  type ConversationDetail,
  type Me,
  type Metrics,
  type QueueItem,
} from './api.js'
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
import { Performance, Team } from './screens/Performance.js'
import { Pulse } from './screens/Pulse.js'
import { useAgentSession } from './useAgentSession.js'

type Aba = 'fila' | 'historico' | 'meus' | 'equipe'

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
  const [eu, setEu] = useState<Me | null>(null)
  const [meus, setMeus] = useState<QueueItem[]>([])
  const [meuDesempenho, setMeuDesempenho] = useState<AgentPerformance | null>(null)
  const [equipe, setEquipe] = useState<AgentPerformance[]>([])
  const [olhando, setOlhando] = useState<AgentPerformance | null>(null)

  const token = sessao?.accessToken ?? null
  const aberto = selecionado

  const carregar = useCallback(async () => {
    if (!token) return
    try {
      const [ativos, resolvidos, m, perfil, meusAtivos, desempenho] = await Promise.all([
        api.queue(token),
        api.queue(token, { status: 'RESOLVED' }),
        api.metrics(token),
        api.me(token),
        api.queue(token, { assignedTo: 'me', status: 'WITH_HUMAN' }),
        api.myPerformance(token),
      ])
      setFila(ativos)
      setEncerrados(resolvidos)
      setMetricas(m)
      setEu(perfil)
      setMeus(meusAtivos)
      setMeuDesempenho(desempenho)
      setErro(null)

      // A equipe só é buscada por quem pode vê-la. Pedir e receber 403 a cada
      // ciclo poluiria o log do servidor e não mudaria nada na tela.
      if (perfil.canViewTeam) {
        setEquipe(await api.teamPerformance(token))
      }

      // O detalhe aberto entra no mesmo ciclo: se outro atendente assumir ou
      // encerrar o caso, a tela precisa refletir isso sem depender de clique.
      if (aberto) {
        try {
          setDetalhe(await api.detail(token, aberto))
        } catch {
          setDetalhe(null)
        }
      }
    } catch (e) {
      // Distinguir os dois casos importa: um se resolve sozinho, o outro exige
      // entrar de novo. Dizer "sem conexão" para uma sessão expirada mandava a
      // pessoa procurar problema onde não havia.
      const expirou = e instanceof ConsoleError && e.code === 'NAO_AUTENTICADO'
      setErro(
        expirou
          ? 'Sessão expirada. Entre novamente para continuar.'
          : 'Sem conexão com o servidor. Nova tentativa em instantes.',
      )
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
    setOlhando(null)
  }

  /** Gestor abre os números de um atendente sem sair da tela da equipe. */
  async function verAtendente(agentId: string) {
    if (!token) return
    try {
      setOlhando(await api.agentPerformance(token, agentId))
    } catch {
      setOlhando(null)
    }
  }

  const base = aba === 'fila' ? fila : aba === 'meus' ? meus : encerrados
  const comLista = aba === 'fila' || aba === 'historico' || aba === 'meus'
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
      <AppHeader
        area="console"
        title="Console de Atendimento"
        identity={{
          name: sessao.agent.name,
          role: sessao.agent.role === 'MANAGER' ? 'Gestão' : 'Atendimento',
        }}
        onSignOut={sair}
        aside={erro ? <span className="appbar__warn">{erro}</span> : null}
      />

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
            aria-current={aba === 'meus'}
            onClick={() => trocarAba('meus')}
          >
            <User size={15} strokeWidth={2} />
            Meus atendimentos
            <span className="nav__badge">{meus.length}</span>
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

          {/* A aba da equipe só existe para quem tem o perfil. Esconder não é
              a proteção: a API recusa de todo jeito. Isto é só não oferecer
              porta que não abre. */}
          {eu?.canViewTeam && (
            <button
              type="button"
              className="nav__item"
              aria-current={aba === 'equipe'}
              onClick={() => trocarAba('equipe')}
            >
              <Users size={15} strokeWidth={2} />
              Equipe
              <span className="nav__badge">{equipe.length}</span>
            </button>
          )}
        </nav>

        {comLista && (
          <Filters
            value={filtros}
            onChange={setFiltros}
            showing={visiveis.length}
            total={base.length}
            withStatus={aba === 'fila'}
          />
        )}
      </div>

      <div className="workarea">
        {aba === 'fila' && (
          <Board items={visiveis} selectedId={selecionado} onSelect={setSelecionado} />
        )}

        {aba === 'meus' && (
          <Board items={visiveis} selectedId={selecionado} onSelect={setSelecionado} />
        )}

        {aba === 'historico' && (
          <History
            items={visiveis}
            selectedId={selecionado}
            onSelect={setSelecionado}
            filtered={filtrosAtivos(filtros)}
          />
        )}

        {aba === 'equipe' &&
          (olhando ? (
            <Performance
              performance={olhando}
              title={olhando.name}
              subtitle={olhando.role === 'MANAGER' ? 'Gestão' : 'Atendimento'}
            />
          ) : (
            <Team team={equipe} selectedId={null} onSelect={verAtendente} />
          ))}

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
