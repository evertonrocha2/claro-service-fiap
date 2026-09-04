/**
 * Os combining marks vão como escape unicode de propósito: um intervalo literal de
 * diacríticos no fonte é invisível e não sobrevive a copiar e colar.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
