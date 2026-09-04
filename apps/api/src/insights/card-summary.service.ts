import { redact } from '../nlp/pii.js'

/**
 * Escreve o título do cartão na fila a partir do que o cliente disse.
 *
 * É enfeite útil, não infraestrutura. O quadro mostra a mensagem crua do
 * cliente, e mensagem crua costuma vir com erro de digitação, sem pontuação e
 * misturada com o CPF que a pessoa colou junto. Como título de cartão isso lê
 * mal e ocupa as duas linhas com pouca informação.
 *
 * O que este serviço NÃO faz, e é o ponto:
 *
 * - não entra na conversa. O resumo vive num campo próprio da conversa e nunca
 *   vira mensagem. O que o cliente lê no chat continua exatamente igual.
 * - não bloqueia a resposta. É chamado sem espera pelo orquestrador; se demorar
 *   ou falhar, a mensagem do cliente já foi respondida.
 * - não é obrigatório. Sem chave do Gemini o serviço nem é montado, o campo fica
 *   nulo e o cartão volta a mostrar a última mensagem, que é o comportamento de
 *   antes. Fallback, e não dependência.
 */
export interface ICardSummaryWriter {
  /** Devolve o título, ou null quando não deu para escrever um. */
  write(text: string): Promise<string | null>
}

export type GeminiCardSummaryOptions = {
  apiKey: string
  model?: string
  /** Injetável para teste. Nenhum teste toca a rede. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * Apelido movel em vez de versao fixada.
 *
 * O nome fixo anterior, gemini-3-flash-preview, passou a responder 429 por cota
 * na camada gratuita, e como toda falha aqui e engolida de proposito, o sistema
 * seguia rodando pelas regras sem ninguem perceber que o modelo estava fora.
 * O apelido acompanha o modelo atual do Google, e GEMINI_MODEL sobrescreve.
 */
const MODELO_PADRAO = 'gemini-flash-latest'

/** Curto: é um cartão de quadro, não uma linha de e-mail. */
const TIMEOUT_PADRAO = 6000
const MAX_CARACTERES = 70

const INSTRUCAO = `Você resume pedidos de clientes de uma operadora de telecomunicações brasileira para virarem título de cartão num quadro de atendimento.

Regras:
- No máximo 8 palavras.
- Português do Brasil, na terceira pessoa, descrevendo o pedido.
- Sem ponto final, sem aspas, sem emoji.
- Comece por um verbo ou pelo substantivo do problema.
- Não invente informação que não está na mensagem.
- Não repita o nome da operadora.

Marcadores como [CPF], [TELEFONE] ou [EMAIL] substituem dados pessoais. Ignore-os no resumo.

Responda SOMENTE com o título, em uma linha.

Exemplos:
"oi, minha internet ta caindo toda hora desde ontem de manha" -> Internet caindo desde ontem
"meu cpf e [CPF], quero a segunda via da fatura desse mes" -> Segunda via da fatura do mês
"quero cancelar meu plano agora" -> Cancelamento de plano`

type RespostaGemini = {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
}

/**
 * Limpa o que o modelo devolve.
 *
 * Ele às vezes entrega o título entre aspas, com ponto final, ou com duas
 * linhas apesar da instrução. Nada disso pode chegar ao cartão.
 */
export function limparTitulo(bruto: string): string | null {
  const primeiraLinha = bruto.split('\n').find((l) => l.trim().length > 0)
  if (!primeiraLinha) return null

  const limpo = primeiraLinha
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.;]+$/, '')
    .trim()

  if (limpo.length === 0) return null

  return limpo.length > MAX_CARACTERES ? `${limpo.slice(0, MAX_CARACTERES - 1).trimEnd()}…` : limpo
}

export class GeminiCardSummary implements ICardSummaryWriter {
  private readonly fetchImpl: typeof fetch
  private readonly model: string
  private readonly timeoutMs: number

  constructor(private readonly options: GeminiCardSummaryOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.model = options.model ?? MODELO_PADRAO
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_PADRAO
  }

  /**
   * Uma tentativa extra, e so para 429 e 503.
   *
   * Sao os dois codigos que o Google devolve para "tente de novo daqui a pouco":
   * cota do minuto e pico de demanda. Numa apresentacao a diferenca entre o
   * cartao sair tratado ou cru costuma ser exatamente uma dessas respostas.
   * Erro de outro tipo nao se repete: se o pedido esta errado, repetir mantem
   * errado e so gasta cota.
   */
  async write(text: string): Promise<string | null> {
    const primeira = await this.tentar(text)
    if (primeira.titulo !== null || !primeira.vaiPassar) return primeira.titulo

    await new Promise((r) => setTimeout(r, 1200))
    return (await this.tentar(text)).titulo
  }

  private async tentar(text: string): Promise<{ titulo: string | null; vaiPassar: boolean }> {
    // Mesmo cuidado do classificador: CPF, telefone e e-mail viram marcadores
    // antes de sair da nossa infraestrutura.
    const redigido = redact(text)

    try {
      const resposta = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.options.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: INSTRUCAO }] },
            contents: [{ role: 'user', parts: [{ text: redigido }] }],
            // Sem teto de tokens: estes modelos gastam orcamento pensando antes
            // de escrever, e um teto baixo devolvia "Internet c" no lugar do
            // titulo. O tamanho ja e limitado pela instrucao e pelo corte final.
            generationConfig: { temperature: 0.2 },
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      )

      if (!resposta.ok) {
        return { titulo: null, vaiPassar: resposta.status === 429 || resposta.status === 503 }
      }

      const corpo = (await resposta.json()) as RespostaGemini
      const bruto = corpo.candidates?.[0]?.content?.parts?.[0]?.text
      return { titulo: bruto ? limparTitulo(bruto) : null, vaiPassar: false }
    } catch {
      // Falhou é o caso normal, não excepcional: sem título o cartão usa a
      // mensagem crua e ninguém fica sem ver o atendimento. Tempo esgotado ou
      // rede fora também passam, então vale a segunda tentativa.
      return { titulo: null, vaiPassar: true }
    }
  }
}
