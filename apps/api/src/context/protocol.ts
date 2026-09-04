/** Protocolo visível ao cliente: 8 dígitos de data mais 5 aleatórios. Também é um
 *  dos meios de identificação previstos no RF002. */
export function generateProtocol(now: Date = new Date()): string {
  const ano = now.getUTCFullYear()
  const mes = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(now.getUTCDate()).padStart(2, '0')
  const sufixo = String(Math.floor(Math.random() * 100_000)).padStart(5, '0')
  return `${ano}${mes}${dia}${sufixo}`
}
