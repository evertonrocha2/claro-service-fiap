import { err, type Intent, ok, type Result } from '@sync/contracts'
import type { OfferInsight, PrismaClient } from '@sync/db'
import type { CustomerWithContext, IMessageRepository } from '../context/index.js'
import { redact } from '../nlp/pii.js'

export const OFFER_KINDS = [
  'RETENCAO',
  'UPGRADE',
  'DESCONTO',
  'SUPORTE_TECNICO',
  'NEGOCIACAO_FATURA',
  'NENHUMA',
] as const

export type OfferKind = (typeof OFFER_KINDS)[number]

export type Recommendation = {
  headline: string
  rationale: string
  offerKind: OfferKind
  confidence: number
  source: 'RULES' | 'LLM'
}

/** Retrato do cliente montado para decidir a oferta. Nada de PII aqui. */
export type CustomerProfile = {
  serviceTypes: string[]
  serviceLabels: string[]
  openInvoices: number
  daysOverdue: number
  intents: Intent[]
  currentIntent: Intent | null
  messageCount: number
  crossedChannels: boolean
}

export interface IOfferWriter {
  write(profile: CustomerProfile): Promise<Result<Recommendation>>
}

const INSTRUCAO = `Você recomenda a próxima oferta para um cliente de telecomunicações brasileiro.

Responda SOMENTE com JSON:
{"headline":"<até 60 caracteres>","rationale":"<até 240 caracteres>","offerKind":"<TIPO>","confidence":<0 a 1>}

Tipos possíveis:
- RETENCAO: cliente sinalizou cancelamento e vale manter
- UPGRADE: cliente satisfeito, cabe plano melhor
- DESCONTO: sensibilidade a preço
- SUPORTE_TECNICO: resolver o problema vem antes de vender
- NEGOCIACAO_FATURA: há fatura em atraso
- NENHUMA: não há oferta adequada agora

headline é o que o atendente diz em voz alta. rationale é por quê, para ele.
Escreva em português do Brasil, direto, sem exclamação e sem jargão de vendas.
Não invente preço, prazo nem nome de produto que não esteja no retrato.`

/**
 * Sugestão de oferta a partir do que já se sabe do cliente.
 *
 * O atendente pega um cancelamento e precisa decidir o que oferecer em segundos.
 * Isto lê cadastro, serviços, faturas e o histórico de intenções e resolve antes
 * de a conversa começar. É o "posso verificar se existe uma oferta melhor" do
 * Cenário 2 do documento, com uma resposta pronta por trás.
 *
 * As regras vêm primeiro e sempre produzem algo, então a tela nunca fica vazia
 * nem depende de cota de LLM. O modelo, quando existe, escreve melhor.
 */
export class OfferInsightService {
  constructor(
    private readonly db: PrismaClient,
    private readonly messages: IMessageRepository,
    private readonly writer?: IOfferWriter,
  ) {}

  async generate(
    customer: CustomerWithContext,
    conversationId: string,
    now = new Date(),
  ): Promise<Result<OfferInsight>> {
    const conversa = await this.db.conversation.findUnique({ where: { id: conversationId } })
    if (!conversa) return err('CONVERSA_NAO_ENCONTRADA', 'Atendimento não encontrado.')

    const historico = await this.db.message.findMany({
      where: { conversationId, intent: { not: null } },
      select: { intent: true },
      distinct: ['intent'],
    })

    const mensagens = await this.messages.listByConversation(conversationId)
    const maisAntiga = customer.invoices[0]

    const profile: CustomerProfile = {
      serviceTypes: customer.services.map((s) => s.type),
      serviceLabels: customer.services.map((s) => s.label),
      openInvoices: customer.invoices.length,
      daysOverdue: maisAntiga
        ? Math.max(0, Math.floor((now.getTime() - maisAntiga.dueDate.getTime()) / 86_400_000))
        : 0,
      intents: historico.map((h) => h.intent).filter((i): i is Intent => i !== null),
      currentIntent: conversa.intent,
      messageCount: mensagens.length,
      crossedChannels: conversa.originChannel !== conversa.currentChannel,
    }

    const porRegras = recommendByRules(profile)

    // O modelo só é chamado quando há um para chamar, e uma falha dele não
    // apaga a sugestão: a das regras já está pronta.
    let escolhida = porRegras
    if (this.writer) {
      const escrita = await this.writer.write(profile)
      if (escrita.success) escolhida = escrita.data
    }

    const gravada = await this.db.offerInsight.create({
      data: {
        customerId: customer.id,
        conversationId,
        headline: escolhida.headline,
        rationale: escolhida.rationale,
        offerKind: escolhida.offerKind,
        confidence: escolhida.confidence,
        source: escolhida.source,
      },
    })

    return ok(gravada)
  }

  /** A mais recente do atendimento, que é a que o atendente deve ver. */
  latestForConversation(conversationId: string): Promise<OfferInsight | null> {
    return this.db.offerInsight.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    })
  }
}

/**
 * Recomendação por regras. Função pura, sem I/O nem rede.
 *
 * A ordem é a ordem de prioridade do negócio: problema técnico aberto vem antes
 * de qualquer venda, porque oferecer upgrade a quem está sem internet queima o
 * atendimento. Fatura atrasada vem antes de retenção, porque a dívida é o
 * motivo provável do cancelamento.
 */
export function recommendByRules(p: CustomerProfile): Recommendation {
  const rotulos = p.serviceLabels.join(' e ') || 'os serviços contratados'

  if (p.currentIntent === 'PROBLEMA_TECNICO' || p.intents.includes('PROBLEMA_TECNICO')) {
    return {
      headline: 'Resolver a instabilidade antes de qualquer oferta',
      rationale: `Há problema técnico aberto em ${rotulos}. Oferecer plano agora tende a piorar a conversa. Trate a falha e registre o atendimento.`,
      offerKind: 'SUPORTE_TECNICO',
      confidence: 0.9,
      source: 'RULES',
    }
  }

  if (p.daysOverdue > 0) {
    return {
      headline: 'Oferecer negociação da fatura em atraso',
      rationale: `Fatura vencida há ${p.daysOverdue} dias, com ${p.openInvoices} em aberto. Regularizar vem antes: a dívida é o motivo provável de o cliente querer sair.`,
      offerKind: 'NEGOCIACAO_FATURA',
      confidence: 0.85,
      source: 'RULES',
    }
  }

  if (p.currentIntent === 'CANCELAMENTO') {
    const varios = p.serviceTypes.length > 1
    return {
      headline: varios
        ? 'Oferecer desconto no combo para manter os dois serviços'
        : 'Oferecer desconto de retenção',
      rationale: varios
        ? `Cliente tem ${p.serviceTypes.length} serviços (${rotulos}). Perder um provavelmente leva o outro, então o desconto no combo custa menos que a saída.`
        : `Cliente com ${rotulos} pediu cancelamento e não tem pendência financeira. Sem dívida no caminho, desconto costuma bastar.`,
      offerKind: 'RETENCAO',
      confidence: 0.8,
      source: 'RULES',
    }
  }

  if (p.currentIntent === 'CONSULTA_PLANO') {
    return {
      headline: 'Apresentar plano superior',
      rationale: `Cliente perguntou sobre ${rotulos} por conta própria e está sem pendência. É o momento de menor resistência para um upgrade.`,
      offerKind: 'UPGRADE',
      confidence: 0.7,
      source: 'RULES',
    }
  }

  return {
    headline: 'Sem oferta recomendada agora',
    rationale:
      'Não há sinal suficiente nesta conversa para sugerir algo. Conduza o atendimento e a recomendação se atualiza conforme a intenção ficar clara.',
    offerKind: 'NENHUMA',
    confidence: 0.4,
    source: 'RULES',
  }
}

type RespostaGemini = {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
}

/**
 * Escritor via Gemini.
 *
 * Recebe o retrato, não a conversa: o texto do cliente nunca sai daqui, e o
 * retrato só carrega contagens, tipos de serviço e intenções. Mesmo assim passa
 * pela redação, como rede de segurança caso um rótulo de serviço venha com dado
 * pessoal dentro.
 */
export class GeminiOfferWriter implements IOfferWriter {
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly apiKey: string,
    private readonly model = 'gemini-3-flash-preview',
    fetchImpl?: typeof fetch,
    private readonly timeoutMs = 8000,
  ) {
    this.fetchImpl = fetchImpl ?? fetch
  }

  async write(profile: CustomerProfile): Promise<Result<Recommendation>> {
    const retrato = redact(JSON.stringify(profile))

    try {
      const resposta = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: INSTRUCAO }] },
            contents: [{ role: 'user', parts: [{ text: retrato }] }],
            generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      )

      if (!resposta.ok) return err('GEMINI_INDISPONIVEL', `Gemini respondeu ${resposta.status}.`)

      const corpo = (await resposta.json()) as RespostaGemini
      const texto = corpo.candidates?.[0]?.content?.parts?.[0]?.text
      if (!texto) return err('GEMINI_SEM_RESPOSTA', 'Gemini não devolveu conteúdo.')

      return parseRecommendation(texto)
    } catch {
      return err('GEMINI_INDISPONIVEL', 'Não foi possível falar com o Gemini.')
    }
  }
}

export function parseRecommendation(bruto: string): Result<Recommendation> {
  const limpo = bruto.replace(/```(?:json)?/g, '').trim()
  const inicio = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (inicio === -1 || fim === -1) {
    return err('RESPOSTA_INVALIDA', 'Não entendi a resposta do modelo.')
  }

  try {
    const d = JSON.parse(limpo.slice(inicio, fim + 1)) as Record<string, unknown>

    const kind = d.offerKind
    if (typeof kind !== 'string' || !(OFFER_KINDS as readonly string[]).includes(kind)) {
      return err('RESPOSTA_INVALIDA', 'Tipo de oferta desconhecido.')
    }

    const headline = typeof d.headline === 'string' ? d.headline.trim() : ''
    const rationale = typeof d.rationale === 'string' ? d.rationale.trim() : ''
    if (headline === '' || rationale === '') {
      return err('RESPOSTA_INVALIDA', 'Recomendação sem texto.')
    }

    const confidence = typeof d.confidence === 'number' ? d.confidence : 0.6

    return ok({
      // Corta em vez de recusar: um texto longo demais é problema de layout,
      // não motivo para o atendente ficar sem sugestão.
      headline: headline.slice(0, 60),
      rationale: rationale.slice(0, 240),
      offerKind: kind as OfferKind,
      confidence: Math.min(Math.max(confidence, 0), 1),
      source: 'LLM',
    })
  } catch {
    return err('RESPOSTA_INVALIDA', 'Não entendi a resposta do modelo.')
  }
}
