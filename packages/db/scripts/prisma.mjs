#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Wrapper do Prisma CLI que carrega o `.env` da raiz do monorepo.
 *
 * O CLI procura `.env` apenas no cwd, que aqui é `packages/db`. Manter uma cópia
 * do DATABASE_URL nesta pasta duplicaria configuração e sairia de sincronia. Este
 * wrapper usa a mesma busca que o `client.ts` faz em tempo de execução.
 */
function carregarEnv() {
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

const { status } = spawnSync(process.execPath, [
  join(process.cwd(), '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
  ...process.argv.slice(2),
], { stdio: 'inherit', env: process.env })

process.exit(status ?? 1)
