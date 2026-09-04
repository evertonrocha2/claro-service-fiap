import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from './generated/prisma/index.js'

/**
 * Sobe a árvore de diretórios procurando o `.env` da raiz do repositório.
 *
 * Vitest, tsx e o servidor entram por caminhos diferentes e nenhum deles carrega
 * `.env` sozinho. Carregar aqui, no único módulo por onde todos passam, evita
 * repetir a configuração em cada ponto de entrada. Se DATABASE_URL já veio do
 * ambiente (CI, Docker, terminal), nada é sobrescrito.
 */
function carregarEnv(): void {
  if (process.env.DATABASE_URL) return

  let dir = dirname(fileURLToPath(import.meta.url))
  for (let nivel = 0; nivel < 6; nivel++) {
    const alvo = join(dir, '.env')
    if (existsSync(alvo)) {
      process.loadEnvFile(alvo)
      return
    }
    const pai = dirname(dir)
    if (pai === dir) return
    dir = pai
  }
}

carregarEnv()

export const prisma = new PrismaClient()
