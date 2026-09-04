import type { Intent } from '@sync/contracts'

export type Rule = { intent: Intent; keyword: string; weight: number }

/**
 * Peso 3 = palavra-chave forte, sozinha basta para chegar ao limiar de aceite de
 * 0.80. Peso 1 = indício, só conta somado a outra coisa.
 *
 * As palavras estão sem acento porque a comparação roda sobre o texto normalizado.
 */
export const RULES: Rule[] = [
  { intent: 'FATURA_SEGUNDA_VIA', keyword: 'segunda via', weight: 3 },
  { intent: 'FATURA_SEGUNDA_VIA', keyword: '2 via', weight: 3 },
  { intent: 'FATURA_SEGUNDA_VIA', keyword: 'codigo de barras', weight: 3 },
  { intent: 'FATURA_SEGUNDA_VIA', keyword: 'boleto', weight: 3 },
  { intent: 'FATURA_SEGUNDA_VIA', keyword: 'fatura', weight: 3 },
  { intent: 'FATURA_SEGUNDA_VIA', keyword: 'vencimento', weight: 1 },
  { intent: 'FATURA_SEGUNDA_VIA', keyword: 'pagar', weight: 1 },

  { intent: 'PROBLEMA_TECNICO', keyword: 'caindo', weight: 3 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'sem sinal', weight: 3 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'nao funciona', weight: 3 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'instabilidade', weight: 3 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'sem conexao', weight: 3 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'lento', weight: 3 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'internet', weight: 1 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'modem', weight: 1 },
  { intent: 'PROBLEMA_TECNICO', keyword: 'roteador', weight: 1 },

  { intent: 'CONSULTA_PLANO', keyword: 'meu plano', weight: 3 },
  { intent: 'CONSULTA_PLANO', keyword: 'qual plano', weight: 3 },
  { intent: 'CONSULTA_PLANO', keyword: 'franquia', weight: 3 },
  { intent: 'CONSULTA_PLANO', keyword: 'upgrade', weight: 3 },
  { intent: 'CONSULTA_PLANO', keyword: 'pacote', weight: 1 },

  { intent: 'CANCELAMENTO', keyword: 'cancelar', weight: 3 },
  { intent: 'CANCELAMENTO', keyword: 'cancelamento', weight: 3 },
  { intent: 'CANCELAMENTO', keyword: 'rescindir', weight: 3 },
  { intent: 'CANCELAMENTO', keyword: 'encerrar contrato', weight: 3 },
  { intent: 'CANCELAMENTO', keyword: 'portabilidade', weight: 3 },

  { intent: 'FALAR_COM_ATENDENTE', keyword: 'atendente', weight: 3 },
  { intent: 'FALAR_COM_ATENDENTE', keyword: 'falar com humano', weight: 3 },
  { intent: 'FALAR_COM_ATENDENTE', keyword: 'falar com alguem', weight: 3 },
  { intent: 'FALAR_COM_ATENDENTE', keyword: 'pessoa de verdade', weight: 3 },
]
