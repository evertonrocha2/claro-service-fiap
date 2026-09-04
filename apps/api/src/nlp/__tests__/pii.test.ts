import { expect, test } from 'vitest'
import { extractEntities, redact } from '../pii.js'
import { normalize } from '../text.js'

test('normaliza acentos, caixa e espaços', () => {
  expect(normalize('  Minha INTERNET está  CAINDO ')).toBe('minha internet esta caindo')
})

test('extrai CPF formatado', () => {
  expect(extractEntities('meu cpf é 123.456.789-00').cpf).toBe('12345678900')
})

test('extrai CPF cru', () => {
  expect(extractEntities('12345678900').cpf).toBe('12345678900')
})

test('não extrai CPF de sequência curta', () => {
  expect(extractEntities('meu plano é o 9876').cpf).toBeUndefined()
})

test('extrai protocolo de 13 dígitos', () => {
  expect(extractEntities('protocolo 2026090300123').protocol).toBe('2026090300123')
})

test('extrai código de handoff', () => {
  expect(extractEntities('Continuar atendimento SYNC-A7K2').handoffCode).toBe('SYNC-A7K2')
})

test('redige CPF, telefone e e-mail', () => {
  const saida = redact('cpf 123.456.789-00, fone (11) 98765-4321, mail a@b.com')
  expect(saida).toContain('[CPF]')
  expect(saida).toContain('[TELEFONE]')
  expect(saida).toContain('[EMAIL]')
  expect(saida).not.toContain('123.456.789-00')
  expect(saida).not.toContain('98765-4321')
  expect(saida).not.toContain('a@b.com')
})
