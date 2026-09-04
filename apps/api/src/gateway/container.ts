import { prisma } from '@sync/db'
import { FirstAccessUseCase } from '../auth/first-access.use-case.js'
import { LoginUseCase } from '../auth/login.use-case.js'
import { LogoutUseCase } from '../auth/logout.use-case.js'
import { PrismaRefreshTokenRepository } from '../auth/refresh-token.repository.js'
import { RefreshUseCase } from '../auth/refresh.use-case.js'
import type { AuthDeps } from '../auth/routes.js'
import { TokenService } from '../auth/tokens.js'
import {
  PrismaConversationRepository,
  PrismaCustomerRepository,
  PrismaMessageRepository,
} from '../context/index.js'
import { ConversationOrchestrator } from '../conversation/orchestrator.js'
import { IdentityService } from '../identity/identity.service.js'
import { RuleClassifier } from '../nlp/rule-classifier.js'

export type Container = {
  orchestrator: ConversationOrchestrator
  auth: AuthDeps
}

/** Raiz de composição. É o único lugar que instancia implementações concretas. */
export function buildContainer(): Container {
  const conversations = new PrismaConversationRepository(prisma)
  const messages = new PrismaMessageRepository(prisma)
  const customers = new PrismaCustomerRepository(prisma)
  const identity = new IdentityService(customers, conversations)

  const refreshTokens = new PrismaRefreshTokenRepository(prisma)
  const tokens = new TokenService(requireJwtSecret())

  return {
    orchestrator: new ConversationOrchestrator(
      identity,
      conversations,
      messages,
      customers,
      new RuleClassifier(),
    ),
    auth: {
      firstAccess: new FirstAccessUseCase(customers),
      login: new LoginUseCase(customers, refreshTokens, tokens),
      refresh: new RefreshUseCase(refreshTokens, tokens),
      logout: new LogoutUseCase(refreshTokens),
      tokens,
    },
  }
}

/**
 * Sem valor padrao de proposito. Um segredo padrao em codigo e a falha de
 * seguranca que mais sobrevive ate producao, porque nada quebra sem ele.
 */
function requireJwtSecret(): string {
  const segredo = process.env.JWT_SECRET
  if (!segredo) {
    throw new Error('JWT_SECRET nao definido. Copie o .env.example para .env.')
  }
  return segredo
}
