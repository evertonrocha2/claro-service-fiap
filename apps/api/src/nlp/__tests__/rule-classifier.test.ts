import { expect, test } from 'vitest'
import { RuleClassifier } from '../rule-classifier.js'

const classificador = new RuleClassifier()

async function classificar(texto: string) {
  const r = await classificador.classify({ text: texto })
  if (!r.success) throw new Error(r.error.message)
  return r.data
}

test.each([
  ['quero a segunda via da minha fatura', 'FATURA_SEGUNDA_VIA'],
  ['preciso do código de barras do boleto', 'FATURA_SEGUNDA_VIA'],
  ['minha internet está caindo toda hora', 'PROBLEMA_TECNICO'],
  ['o modem não funciona', 'PROBLEMA_TECNICO'],
  ['qual é o meu plano atual', 'CONSULTA_PLANO'],
  ['quero cancelar meu plano', 'CANCELAMENTO'],
  ['quero falar com um atendente', 'FALAR_COM_ATENDENTE'],
])('classifica "%s" como %s', async (texto, esperado) => {
  const c = await classificar(texto)
  expect(c.intent).toBe(esperado)
  expect(c.confidence).toBeGreaterThanOrEqual(0.8)
})

test('cancelamento vence problema técnico quando as duas aparecem', async () => {
  const c = await classificar('quero cancelar minha internet')
  expect(c.intent).toBe('CANCELAMENTO')
})

test('em empate de placar a intenção mais sensível vence', async () => {
  // "cancelar" e "meu plano" valem 3 cada. Sem desempate, ganharia CONSULTA_PLANO
  // só por aparecer antes na tabela de regras, o que seria um erro perigoso.
  const c = await classificar('quero cancelar meu plano')
  expect(c.intent).toBe('CANCELAMENTO')
})

test('texto sem palavra-chave vira DESCONHECIDA com confiança zero', async () => {
  const c = await classificar('bom dia tudo bem com você')
  expect(c.intent).toBe('DESCONHECIDA')
  expect(c.confidence).toBe(0)
})

test('a origem é sempre RULES', async () => {
  const c = await classificar('quero cancelar')
  expect(c.source).toBe('RULES')
})

test('as entidades do texto vêm junto', async () => {
  const c = await classificar('meu cpf é 123.456.789-00 e quero cancelar')
  expect(c.entities.cpf).toBe('12345678900')
})
