#!/usr/bin/env node
/**
 * Cria e sincroniza o banco usado pelos testes.
 *
 * Separado do banco de desenvolvimento de proposito: a suite limpa as tabelas
 * entre os testes, e apontar os dois para o mesmo lugar apagava as contas da
 * demonstracao a cada `npm test`.
 *
 * Chama o CLI do Prisma pelo mesmo caminho que scripts/prisma.mjs usa, so que
 * com DATABASE_URL trocado. O `db push` cria o banco se ele ainda nao existir.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const pacote = dirname(aqui)

let dir = aqui
for (let i = 0; i < 6 && !existsSync(join(dir, '.env')); i++) dir = dirname(dir)
if (existsSync(join(dir, '.env'))) process.loadEnvFile(join(dir, '.env'))

const url = process.env.TEST_DATABASE_URL ?? 'mysql://root:sync@localhost:3307/sync_test'
console.log(`Banco de teste: ${url.replace(/\/\/[^@]+@/, '//***@')}`)

const { status } = spawnSync(
  process.execPath,
  [
    join(pacote, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
    'db',
    'push',
    '--skip-generate',
    '--accept-data-loss',
  ],
  { stdio: 'inherit', cwd: pacote, env: { ...process.env, DATABASE_URL: url } },
)

process.exit(status ?? 1)
