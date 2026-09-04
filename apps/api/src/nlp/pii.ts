export type ExtractedEntities = {
  cpf?: string
  protocol?: string
  handoffCode?: string
}

const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/
const PROTOCOL_RE = /\b\d{13}\b/
const HANDOFF_RE = /\bSYNC-[A-Z0-9]{4}\b/i
const PHONE_RE = /\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g

/**
 * Sequências de 11 dígitos no texto são tratadas como CPF, nunca como telefone.
 * CPF e celular brasileiro têm o mesmo comprimento, então adivinhar seria chute.
 * O telefone vem sempre dos metadados do canal, não do que o cliente digitou.
 */
export function extractEntities(text: string): ExtractedEntities {
  const entidades: ExtractedEntities = {}

  const protocolo = PROTOCOL_RE.exec(text)
  if (protocolo) entidades.protocol = protocolo[0]

  const handoff = HANDOFF_RE.exec(text)
  if (handoff) entidades.handoffCode = handoff[0].toUpperCase()

  const semProtocolo = protocolo ? text.replace(protocolo[0], ' ') : text
  const cpf = CPF_RE.exec(semProtocolo)
  if (cpf) {
    const digitos = cpf[0].replace(/\D/g, '')
    if (digitos.length === 11) entidades.cpf = digitos
  }

  return entidades
}

/**
 * A ordem importa. E-mail primeiro, porque pode conter sequência numérica que
 * casaria com telefone. CPF antes de telefone, porque o padrão de telefone é mais
 * permissivo e engoliria parte do CPF.
 */
export function redact(text: string): string {
  return text
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(CPF_RE, '[CPF]')
    .replace(PHONE_RE, '[TELEFONE]')
}
