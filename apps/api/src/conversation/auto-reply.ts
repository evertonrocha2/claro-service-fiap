import type { Intent } from '@sync/contracts'
import type { EscalationReason } from './escalation-policy.js'

export type ReplyContext = {
  customerName?: string
  identified: boolean
  openInvoice?: { dueDate: Date; barcode: string }
  services: { type: string; label: string }[]
}

function formatarData(data: Date): string {
  const dia = String(data.getUTCDate()).padStart(2, '0')
  const mes = String(data.getUTCMonth() + 1).padStart(2, '0')
  return `${dia}/${mes}`
}

const PEDIR_IDENTIFICACAO =
  'Para localizar seu cadastro, você pode informar seu CPF ou fazer login na sua conta Claro.'

export function buildAutoReply(intent: Intent, ctx: ReplyContext): string {
  if (!ctx.identified && intent !== 'DESCONHECIDA') {
    return `Entendi seu pedido. ${PEDIR_IDENTIFICACAO}`
  }

  switch (intent) {
    case 'FATURA_SEGUNDA_VIA': {
      if (!ctx.openInvoice) {
        return 'Não encontrei nenhuma fatura em aberto no seu cadastro. Quer consultar faturas anteriores?'
      }
      return `Localizei sua fatura em aberto com vencimento em ${formatarData(ctx.openInvoice.dueDate)}. Deseja receber o código de barras ou baixar o PDF?`
    }

    case 'PROBLEMA_TECNICO': {
      const servico = ctx.services.find((s) => s.type === 'INTERNET_RESIDENCIAL') ?? ctx.services[0]
      const alvo = servico ? ` no serviço ${servico.label}` : ''
      return `Identifiquei que sua solicitação é sobre instabilidade de conexão${alvo}. Posso fazer uma verificação inicial por aqui. O modem está ligado e com as luzes de internet piscando?`
    }

    case 'CONSULTA_PLANO': {
      if (ctx.services.length === 0) {
        return 'Não encontrei serviços ativos no seu cadastro. Quer que eu verifique com um atendente?'
      }
      const lista = ctx.services.map((s) => `- ${s.label}`).join('\n')
      return `Estes são os serviços ativos no seu cadastro:\n${lista}\n\nQuer detalhes de algum deles?`
    }

    default:
      return 'Não entendi bem o seu pedido. Você pode reformular? Posso ajudar com fatura, problema técnico ou consulta de plano.'
  }
}

const NOME_DO_CANAL: Record<string, string> = {
  SITE: 'no site',
  APP: 'no aplicativo',
  WHATSAPP: 'no WhatsApp',
}

const ASSUNTO: Record<Intent, string> = {
  FATURA_SEGUNDA_VIA: 'a segunda via da sua fatura',
  PROBLEMA_TECNICO: 'a instabilidade na sua conexão',
  CONSULTA_PLANO: 'a consulta do seu plano',
  CANCELAMENTO: 'o cancelamento do plano',
  FALAR_COM_ATENDENTE: 'o atendimento com uma pessoa',
  DESCONHECIDA: 'o seu atendimento',
}

/**
 * Primeira fala depois da troca de canal.
 *
 * É a frase do Cenário 1 do Documento de Visão, e é onde o produto se prova: em
 * vez de recomeçar, o Sync diz de onde a conversa veio e o que já sabe. Nada de
 * classificar o texto do link, que é controle e não pedido.
 */
export function buildHandoffReply(
  originChannel: string,
  intent: Intent | null,
  ctx: ReplyContext,
): string {
  const origem = NOME_DO_CANAL[originChannel] ?? 'em outro canal'
  const assunto = ASSUNTO[intent ?? 'DESCONHECIDA']

  const servico = ctx.services.find((s) => s.type === 'INTERNET_RESIDENCIAL') ?? ctx.services[0]
  const detalhe = ctx.identified && servico ? ` no serviço ${servico.label}` : ''

  return `Olá! Continuando seu atendimento iniciado ${origem}. Já identifiquei que é sobre ${assunto}${detalhe}. Vamos seguir daqui?`
}

export function buildEscalationReply(reason: EscalationReason): string {
  switch (reason) {
    case 'SENSITIVE_INTENT':
      return 'Como essa solicitação precisa de validação adicional, vou direcionar você para um atendente. Ele receberá o histórico desta conversa, então você não precisará explicar tudo novamente.'
    case 'CUSTOMER_REQUEST':
      return 'Claro. Vou transferir você para um atendente agora. Ele já vai receber o histórico desta conversa.'
    case 'REPEATED_UNKNOWN':
      return 'Prefiro não te fazer repetir mais. Vou chamar um atendente, e ele receberá o histórico desta conversa.'
    case 'LOW_CONFIDENCE':
      return 'Quero garantir que você seja bem atendido. Vou passar para um atendente com o histórico desta conversa.'
  }
}
