import { expect, test } from 'vitest'
import { type ReplyContext, buildAutoReply, buildEscalationReply } from '../auto-reply.js'

const identificado: ReplyContext = {
  customerName: 'Maria Silva',
  identified: true,
  openInvoice: { dueDate: new Date('2026-05-20T00:00:00.000Z'), barcode: '0000 1111 2222' },
  services: [{ type: 'INTERNET_RESIDENCIAL', label: 'Claro Net Fibra 500 Mega' }],
}

const anonimo: ReplyContext = { identified: false, services: [] }

test('fatura identificada cita o vencimento', () => {
  expect(buildAutoReply('FATURA_SEGUNDA_VIA', identificado)).toContain('20/05')
})

test('fatura sem identificação pede CPF ou login', () => {
  expect(buildAutoReply('FATURA_SEGUNDA_VIA', anonimo).toLowerCase()).toContain('cpf')
})

test('problema técnico identificado cita o serviço', () => {
  expect(buildAutoReply('PROBLEMA_TECNICO', identificado)).toContain('Claro Net Fibra 500 Mega')
})

test('consulta de plano lista os serviços', () => {
  expect(buildAutoReply('CONSULTA_PLANO', identificado)).toContain('Claro Net Fibra 500 Mega')
})

test('desconhecida pede reformulação sem culpar o cliente', () => {
  expect(buildAutoReply('DESCONHECIDA', identificado).toLowerCase()).toContain('não entendi')
})

test('escalonamento por intenção sensível avisa que o histórico vai junto', () => {
  expect(buildEscalationReply('SENSITIVE_INTENT').toLowerCase()).toContain('histórico')
})

test('nenhuma resposta contém CPF cru', () => {
  for (const intent of ['FATURA_SEGUNDA_VIA', 'PROBLEMA_TECNICO', 'CONSULTA_PLANO'] as const) {
    expect(buildAutoReply(intent, identificado)).not.toMatch(/\d{11}/)
  }
})
