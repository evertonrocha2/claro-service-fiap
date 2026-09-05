import { prisma } from '@sync/db'

/**
 * Deixa o banco vazio antes e depois da suíte.
 *
 * Cada arquivo já limpa o que vai usar, mas o último teste de cada arquivo
 * deixava as próprias linhas para trás: no fim de uma execução sobravam
 * conversas órfãs no banco de desenvolvimento. Como não há mais seed, o estado
 * esperado fora dos testes é base vazia, e é isso que este gancho garante.
 */
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

export async function setup(): Promise<() => Promise<void>> {
  await limpar()

  return async () => {
    await limpar()
    await prisma.$disconnect()
  }
}
