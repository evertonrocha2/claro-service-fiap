import { err, INTENTS, type Intent, ok, type Result } from '@sync/contracts'
import { extractEntities, redact } from './pii.js'
import type { Classification, ClassifyInput, IIntentClassifier } from './types.js'

export type GeminiOptions = {
  apiKey: string
  model?: string
  /** Injetável para teste. Nenhum teste toca a rede. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const MODELO_PADRAO = 'gemini-3-flash-preview'
const TIMEOUT_PADRAO = 8000

const INSTRUCAO = `Você classifica mensagens de clientes de uma operadora de telecomunicações brasileira.

Responda SOMENTE com JSON no formato:
{"intent":"<INTENCAO>","confidence":<0 a 1>}

Intenções possíveis:
- FATURA_SEGUNDA_VIA: segunda via, boleto, código de barras, vencimento, pagamento
- PROBLEMA_TECNICO: internet caindo, lentidão, sem sinal, modem, instabilidade
- CONSULTA_PLANO: qual é o plano, franquia, pacote, upgrade
- CANCELAMENTO: cancelar, rescindir, encerrar contrato, portabilidade
- FALAR_COM_ATENDENTE: pedido explícito de atendimento humano
- DESCONHECIDA: quando nada acima se aplica com clareza

Dados pessoais aparecem como [CPF], [TELEFONE] ou [EMAIL]. Isso é esperado.
Use confidence baixa quando a mensagem for ambígua.`

type RespostaGemini = {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
}

function parseIntent(bruto: string): { intent: Intent; confidence: number } | null {
  // O modelo às vezes embrulha o JSON em cerca de markdown, apesar da instrução.
  const limpo = bruto.replace(/```(?:json)?/g, '').trim()
  const inicio = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (inicio === -1 || fim === -1) return null

  try {
    const dados = JSON.parse(limpo.slice(inicio, fim + 1)) as Record<string, unknown>
    const intent = dados.intent
    if (typeof intent !== 'string' || !(INTENTS as readonly string[]).includes(intent)) return null

    const confidence = typeof dados.confidence === 'number' ? dados.confidence : 0.7
    return {
      intent: intent as Intent,
      confidence: Math.min(Math.max(confidence, 0), 1),
    }
  } catch {
    return null
  }
}

/**
 * Classificador por LLM.
 *
 * Só recebe texto redigido: CPF, telefone e e-mail viram marcadores antes de sair
 * da nossa infraestrutura. As entidades reais são extraídas localmente por regex,
 * então nada de dado pessoal chega ao Google (RNF001 e LGPD).
 */
export class GeminiClassifier implements IIntentClassifier {
  private readonly fetchImpl: typeof fetch
  private readonly model: string
  private readonly timeoutMs: number

  constructor(private readonly options: GeminiOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.model = options.model ?? MODELO_PADRAO
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_PADRAO
  }

  async classify(input: ClassifyInput): Promise<Result<Classification>> {
    const redigido = redact(input.text)
    const controle = AbortSignal.timeout(this.timeoutMs)

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
            generationConfig: { temperature: 0, responseMimeType: 'application/json' },
          }),
          signal: controle,
        },
      )

      if (!resposta.ok) {
        return err('GEMINI_INDISPONIVEL', `Gemini respondeu ${resposta.status}.`)
      }

      const corpo = (await resposta.json()) as RespostaGemini
      const texto = corpo.candidates?.[0]?.content?.parts?.[0]?.text
      if (!texto) return err('GEMINI_SEM_RESPOSTA', 'Gemini não devolveu conteúdo.')

      const analisado = parseIntent(texto)
      if (!analisado) return err('GEMINI_RESPOSTA_INVALIDA', 'Não entendi a resposta do Gemini.')

      return ok({
        intent: analisado.intent,
        confidence: analisado.confidence,
        entities: extractEntities(input.text),
        source: 'LLM',
      })
    } catch {
      return err('GEMINI_INDISPONIVEL', 'Não foi possível falar com o Gemini.')
    }
  }
}
