import { err, ok, type Result } from '@sync/contracts'

/**
 * Normaliza telefone brasileiro para E.164.
 *
 * O número é a chave que liga a conversa do site ao WhatsApp, então precisa sair
 * daqui num formato só. Quem digita escreve de dez maneiras diferentes, e o
 * webhook da Meta entrega em outra: comparar texto cru nunca casaria.
 *
 * Aceita 10 ou 11 dígitos com DDD, com ou sem o 55 na frente, e com qualquer
 * pontuação. Recusa o resto em vez de adivinhar.
 */
export function normalizePhone(bruto: string): Result<string> {
  const digitos = bruto.replace(/\D/g, '')

  const semPais = digitos.startsWith('55') && digitos.length > 11 ? digitos.slice(2) : digitos

  if (semPais.length !== 10 && semPais.length !== 11) {
    return err('TELEFONE_INVALIDO', 'Informe o telefone com DDD, como (11) 98765-4321.')
  }

  const ddd = Number(semPais.slice(0, 2))
  if (ddd < 11 || ddd > 99) {
    return err('TELEFONE_INVALIDO', 'DDD inválido.')
  }

  return ok(`+55${semPais}`)
}

/** Formato de leitura para a interface: +5511987654321 vira (11) 98765-4321. */
export function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return e164
}
