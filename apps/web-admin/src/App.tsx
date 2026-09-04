import { AppHeader, CustomerSiteLink } from '@sync/chat-ui'
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
import { useTicketRoute } from './route.js'
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
import { MyDashboard } from './screens/MyDashboard.js'
import { Team } from './screens/Performance.js'
import { Pulse } from './screens/Pulse.js'
import { TicketPage } from './screens/TicketPage.js'
import { useAgentSession } from './useAgentSession.js'

/**
 * Cada tela responde a uma pergunta diferente, e o menu muda com o perfil.
 *
 * Atendente:  Fila | Meu painel | Historico
 * Gestao:     Fila | Equipe     | Historico
 *
 * A gestao nao tem "Meu painel" porque a pergunta dela nao e "como eu estou", e
 * "como cada pessoa esta". Ela se ve como uma linha na propria lista da equipe,
 * e clicar nessa linha abre o mesmo painel. Uma tela so, dois caminhos.
 */
type Aba = 'fila' | 'painel' | 'historico' | 'equipe'

const LISTAS_DE_CONVERSA: Aba[] = ['fila', 'historico']

const INTERVALO_MS = 5000

export function App() {
  const { sessao, entrar, sair } = useAgentSession()
  const atendimentoNaRota = useTicketRoute()
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
  const [conversasDoOutro, setConversasDoOutro] = useState<QueueItem[]>([])

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

      // A equipe so e buscada por quem pode ve-la. Pedir e receber 403 a cada
      // ciclo poluiria o log do servidor e nao mudaria nada na tela.
      if (perfil.canViewTeam) {
        setEquipe(await api.teamPerformance(token))
      }

      if (aberto) {
        try {
          setDetalhe(await api.detail(token, aberto))
        } catch {
          setDetalhe(null)
        }
      }
    } catch (e) {
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

  function trocarAba(nova: Aba) {
    setAba(nova)
    setFiltros(FILTRO_VAZIO)
    setOlhando(null)
    setConversasDoOutro([])
    // Fecha o detalhe ao trocar de tela: deixa-lo aberto mostrava uma conversa
    // sem relacao ao lado dos numeros de outra pessoa.
    setSelecionado(null)
  }

  /** Gestor abre o painel de um atendente, com os numeros e a mao dele. */
  async function verAtendente(agentId: string) {
    if (!token) return
    try {
      const [desempenho, conversas] = await Promise.all([
        api.agentPerformance(token, agentId),
        api.queue(token, { assignedTo: agentId, status: 'WITH_HUMAN' }),
      ])
      setOlhando(desempenho)
      setConversasDoOutro(conversas)
      setSelecionado(null)
    } catch {
      setOlhando(null)
    }
  }

  // Se a gestora estiver na aba pessoal por qualquer motivo, o lugar dela e a
  // equipe. Esconder o botao sem redirecionar deixaria uma tela sem saida.
  const abaEfetiva: Aba = aba === 'painel' && eu?.canViewTeam ? 'equipe' : aba

  const base = abaEfetiva === 'fila' ? fila : encerrados
  const visiveis = useMemo(() => aplicarFiltros(base, filtros), [base, filtros])

  if (!sessao || !token) {
    return <AgentLogin onEntrar={entrar} />
  }

  // A aba aberta num atendimento especifico nao monta o console inteiro: a fila
  // atras dela continua atualizando na outra aba, e duas copias buscando a
  // mesma lista a cada cinco segundos e desperdicio.
  if (atendimentoNaRota) {
    return <TicketPage session={sessao} conversationId={atendimentoNaRota} onSignOut={sair} />
  }

  async function aposMudanca() {
    await carregar()
    if (selecionado) await carregarDetalhe(selecionado)
  }

  const listaDeConversa = LISTAS_DE_CONVERSA.includes(abaEfetiva)

  // A faixa de indicadores e da operacao inteira. No painel pessoal ela
  // competiria com os numeros da propria pessoa e os dois se confundiriam.
  const mostrarPulse = abaEfetiva === 'fila' || abaEfetiva === 'equipe'

  return (
    <div className="shell">
      <AppHeader
        title="Console de Atendimento"
        nav={<CustomerSiteLink />}
        identity={{
          name: sessao.agent.name,
          role: sessao.agent.role === 'MANAGER' ? 'Gestão' : 'Atendimento',
        }}
        onSignOut={sair}
        aside={erro ? <span className="appbar__warn">{erro}</span> : null}
      />

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

          {/* Atendente ve o proprio painel aqui. Gestao chega ao dela pela
              lista da equipe, onde aparece como uma linha entre as outras. */}
          {eu && !eu.canViewTeam && (
            <button
              type="button"
              className="nav__item"
              aria-current={aba === 'painel'}
              onClick={() => trocarAba('painel')}
            >
              <User size={15} strokeWidth={2} />
              Meu painel
              {meus.length > 0 && <span className="nav__badge">{meus.length}</span>}
            </button>
          )}

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

        {listaDeConversa && (
          <Filters
            value={filtros}
            onChange={setFiltros}
            showing={visiveis.length}
            total={base.length}
            withStatus={aba === 'fila'}
          />
        )}
      </div>

      {mostrarPulse && <Pulse metrics={metricas} />}

      <div className="workarea">
        {abaEfetiva === 'fila' && (
          <Board items={visiveis} selectedId={selecionado} onSelect={setSelecionado} />
        )}

        {abaEfetiva === 'historico' && (
          <History
            items={visiveis}
            selectedId={selecionado}
            onSelect={setSelecionado}
            filtered={filtrosAtivos(filtros)}
          />
        )}

        {abaEfetiva === 'painel' && (
          <MyDashboard
            performance={meuDesempenho}
            conversations={meus}
            selectedId={selecionado}
            onSelect={setSelecionado}
          />
        )}

        {abaEfetiva === 'equipe' &&
          (olhando ? (
            <MyDashboard
              performance={olhando}
              conversations={conversasDoOutro}
              selectedId={selecionado}
              onSelect={setSelecionado}
              viewingOther={{
                name: olhando.name,
                role: olhando.role === 'MANAGER' ? 'Gestão' : 'Atendimento',
              }}
              onBack={() => {
                setOlhando(null)
                setConversasDoOutro([])
                setSelecionado(null)
              }}
            />
          ) : (
            <Team team={equipe} selectedId={null} onSelect={verAtendente} />
          ))}

        {/* O detalhe acompanha as telas de conversa. Nas de numero, ao lado de
            indicadores que nao tem relacao com ele, seria ruido. */}
        {detalhe ? (
          <Detail
            token={token}
            detail={detalhe}
            agentId={sessao.agent.id}
            onChanged={aposMudanca}
          />
        ) : (
          listaDeConversa && <EmptyDetail />
        )}
      </div>
    </div>
  )
}
