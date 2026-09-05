import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Deixa o banco de teste vazio antes e depois da suíte.
 *
 * Aponta para o mesmo banco separado que o vitest.setup.ts usa, e por isso o
 * import do Prisma é dinâmico: precisa acontecer depois da troca da URL, e um
 * import estático subiria antes.
 */
function raizDoRepo(): string {
  let dir = process.cwd()
  for (let nivel = 0; nivel < 6; nivel++) {
    if (existsSync(join(dir, 'vitest.config.ts'))) return dir
    dir = join(dir, '..')
  }
  return process.cwd()
}

const env = join(raizDoRepo(), '.env')
if (existsSync(env)) process.loadEnvFile(env)

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'mysql://root:sync@localhost:3307/sync_test'

export async function setup(): Promise<() => Promise<void>> {
  const { prisma } = await import('@sync/db')

  async function limpar(): Promise<void> {
    await prisma.offerInsight.deleteMany()
    await prisma.message.deleteMany()
    await prisma.handoffToken.deleteMany()
    await prisma.conversation.deleteMany()
    await prisma.invoice.deleteMany()
    await prisma.service.deleteMany()
    await prisma.passwordResetToken.deleteMany()
    await prisma.refreshToken.deleteMany()
    await prisma.intentCache.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.agent.deleteMany()
  }

  await limpar()

  return async () => {
    await limpar()
    await prisma.$disconnect()
  }
}
