import { prisma } from '@sync/db'
import { AdminService } from '../admin/admin.service.js'
import type { AdminDeps } from '../admin/routes.js'
import { PrismaAgentRepository } from '../auth/agent.repository.js'
import { FirstAccessUseCase } from '../auth/first-access.use-case.js'
import { LoginUseCase } from '../auth/login.use-case.js'
import { LogoutUseCase } from '../auth/logout.use-case.js'
import { RefreshUseCase } from '../auth/refresh.use-case.js'
import { PrismaRefreshTokenRepository } from '../auth/refresh-token.repository.js'
import type { AuthDeps } from '../auth/routes.js'
import { TokenService } from '../auth/tokens.js'
import {
  PrismaConversationRepository,
  PrismaCustomerRepository,
  PrismaMessageRepository,
} from '../context/index.js'
import { ConversationOrchestrator } from '../conversation/orchestrator.js'
import { IdentityService } from '../identity/identity.service.js'
import { GeminiClassifier } from '../nlp/gemini-classifier.js'
import { HybridClassifier } from '../nlp/hybrid-classifier.js'
import { PrismaIntentCacheRepository } from '../nlp/intent-cache.repository.js'
import { RuleClassifier } from '../nlp/rule-classifier.js'
import type { IIntentClassifier } from '../nlp/types.js'

export type Container = {
  orchestrator: ConversationOrchestrator
  auth: AuthDeps
  admin: AdminDeps
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
      buildClassifier(),
    ),
    auth: {
      firstAccess: new FirstAccessUseCase(customers),
      login: new LoginUseCase(customers, refreshTokens, tokens, new PrismaAgentRepository(prisma)),
      refresh: new RefreshUseCase(refreshTokens, tokens),
      logout: new LogoutUseCase(refreshTokens),
      tokens,
    },
    admin: {
      service: new AdminService(prisma, messages),
      tokens,
    },
  }
}

/**
 * Regras sempre. Gemini so quando ha chave.
 *
 * Sem GEMINI_API_KEY o sistema nao quebra: perde a compreensao de frase torta e
 * segue resolvendo tudo que uma palavra-chave forte alcanca. Isso mantem a demo
 * viva quando a cota do tier gratuito acaba ou a internet cai.
 */
function buildClassifier(): IIntentClassifier {
  const rules = new RuleClassifier()
  const cache = new PrismaIntentCacheRepository(prisma)
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    console.warn('GEMINI_API_KEY ausente. Classificando apenas por regras.')
    return new HybridClassifier({ rules, cache })
  }

  const options: { apiKey: string; model?: string } = { apiKey }
  if (process.env.GEMINI_MODEL) options.model = process.env.GEMINI_MODEL

  return new HybridClassifier({ rules, cache, llm: new GeminiClassifier(options) })
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
