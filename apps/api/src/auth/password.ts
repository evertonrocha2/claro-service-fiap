import { hash, verify } from '@node-rs/argon2'

/**
 * Argon2id com os parâmetros padrão do @node-rs/argon2 (m=19456, t=2, p=1), que
 * seguem a recomendação do OWASP. O salt é gerado por chamada e vai embutido no
 * hash, então não há nada a guardar separadamente.
 */
export function hashPassword(senha: string): Promise<string> {
  return hash(senha)
}

/**
 * Devolve false para hash malformado em vez de propagar exceção. Um registro
 * corrompido no banco não deve derrubar a rota de login.
 */
export async function verifyPassword(hashArmazenado: string, senha: string): Promise<boolean> {
  try {
    return await verify(hashArmazenado, senha)
  } catch {
    return false
  }
}
