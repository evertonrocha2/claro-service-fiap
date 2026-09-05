import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Aponta os testes para um banco separado.
 *
 * Antes a suíte usava o mesmo MySQL do desenvolvimento e limpava as tabelas
 * entre os testes. Isso significa que rodar `npm test` apagava as contas de
 * demonstração e qualquer conversa em andamento: você voltava para a tela e o
 * console estava vazio, sem nenhum aviso.
 *
 * Roda antes de cada arquivo de teste, e antes dos imports dele, então o cliente
 * Prisma nasce já apontado para o banco certo. O `.env` é carregado aqui porque
 * o container precisa do segredo dos tokens; só a URL do banco é trocada.
 */
function raizDoRepo(): string {
  let dir = process.cwd()
  for (let nivel = 0; nivel < 6; nivel++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'vitest.config.ts'))) return dir
    dir = join(dir, '..')
  }
  return process.cwd()
}

const env = join(raizDoRepo(), '.env')
if (existsSync(env)) process.loadEnvFile(env)

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'mysql://root:sync@localhost:3307/sync_test'
