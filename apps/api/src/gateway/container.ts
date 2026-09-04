import { prisma } from '@sync/db'
import { AdminService } from '../admin/admin.service.js'
import { AgentPerformanceService } from '../admin/agent-performance.service.js'
import type { AdminDeps } from '../admin/routes.js'
import { PrismaAgentRepository } from '../auth/agent.repository.js'
import { FirstAccessUseCase } from '../auth/first-access.use-case.js'
import { LoginUseCase } from '../auth/login.use-case.js'
import { LogoutUseCase } from '../auth/logout.use-case.js'
import { PasswordResetUseCase } from '../auth/password-reset.use-case.js'
import { RefreshUseCase } from '../auth/refresh.use-case.js'
import { PrismaRefreshTokenRepository } from '../auth/refresh-token.repository.js'
import type { AuthDeps } from '../auth/routes.js'
import { TokenService } from '../auth/tokens.js'
import {
  PrismaConversationRepository,
  PrismaCustomerRepository,
  PrismaMessageRepository,
} from '../context/index.js'
import { HandoffUseCase } from '../conversation/handoff.use-case.js'
import { ConversationOrchestrator } from '../conversation/orchestrator.js'
import { ReadConversationUseCase } from '../conversation/read-conversation.use-case.js'
import { SetContactUseCase } from '../conversation/set-contact.use-case.js'
import { IdentityService } from '../identity/identity.service.js'
import { GeminiOfferWriter, OfferInsightService } from '../insights/offer-insight.service.js'
import { GeminiClassifier } from '../nlp/gemini-classifier.js'
import { HybridClassifier } from '../nlp/hybrid-classifier.js'
import { PrismaIntentCacheRepository } from '../nlp/intent-cache.repository.js'
import { RuleClassifier } from '../nlp/rule-classifier.js'
import type { IIntentClassifier } from '../nlp/types.js'

export type Container = {
  orchestrator: ConversationOrchestrator
  handoff: HandoffUseCase
  /** mock aceita a porta local do WhatsApp; meta so aceita o webhook assinado. */
  whatsappDriver: 'mock' | 'meta'
  readConversation: ReadConversationUseCase
  setContact: SetContactUseCase
  auth: AuthDeps
  admin: AdminDeps
}

/**
 * Escolhe o driver do WhatsApp, e recusa o silêncio em produção.
 *
 * O mock abre uma porta HTTP sem assinatura nenhuma: quem posta nela declara o
 * telefone que quiser. Isso é aceitável em desenvolvimento e é uma falha em
 * produção, então esquecer a variável no deploy não pode cair no mock por
 * padrão. Sem WHATSAPP_DRIVER definido, produção não sobe.
 */
function resolveWhatsAppDriver(): 'mock' | 'meta' {
  const escolhido = process.env.WHATSAPP_DRIVER

  if (process.env.NODE_ENV === 'production' && escolhido !== 'meta' && escolhido !== 'mock') {
    throw new Error(
      'WHATSAPP_DRIVER é obrigatório em produção. Use meta, ou mock de forma explícita.',
    )
  }

  return escolhido === 'meta' ? 'meta' : 'mock'
}

/** Raiz de composição. É o único lugar que instancia implementações concretas. */
export function buildContainer(): Container {
  const whatsappDriver = resolveWhatsAppDriver()
  const conversations = new PrismaConversationRepository(prisma)
  const messages = new PrismaMessageRepository(prisma)
  const customers = new PrismaCustomerRepository(prisma)
  const identity = new IdentityService(customers, conversations)

  const handoff = new HandoffUseCase(prisma, conversations, {
    driver: whatsappDriver,
    ...(process.env.WHATSAPP_FROM_NUMBER ? { fromNumber: process.env.WHATSAPP_FROM_NUMBER } : {}),
    ...(process.env.WHATSAPP_MOCK_URL ? { mockUrl: process.env.WHATSAPP_MOCK_URL } : {}),
  })

  const agents = new PrismaAgentRepository(prisma)
  const refreshTokens = new PrismaRefreshTokenRepository(prisma)
  const tokens = new TokenService(requireJwtSecret())

  return {
    orchestrator: new ConversationOrchestrator(
      identity,
      conversations,
      messages,
      customers,
      buildClassifier(),
      handoff,
    ),
    handoff,
    whatsappDriver,
    readConversation: new ReadConversationUseCase(conversations, messages, customers),
    setContact: new SetContactUseCase(conversations),
    auth: {
      firstAccess: new FirstAccessUseCase(customers),
      login: new LoginUseCase(customers, refreshTokens, tokens, agents),
      refresh: new RefreshUseCase(refreshTokens, tokens),
      logout: new LogoutUseCase(refreshTokens),
      passwordReset: new PasswordResetUseCase(
        prisma,
        customers,
        refreshTokens,
        process.env.NODE_ENV === 'production',
      ),
      tokens,
    },
    admin: {
      service: new AdminService(prisma, messages, buildOfferService(messages), customers),
      performance: new AgentPerformanceService(prisma),
      agents,
      tokens,
    },
  }
}

/**
 * A sugestao de oferta usa o mesmo criterio do classificador: as regras sempre
 * produzem algo, e o modelo entra apenas quando ha chave para chama-lo.
 */
function buildOfferService(messages: PrismaMessageRepository): OfferInsightService {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return new OfferInsightService(prisma, messages)

  return new OfferInsightService(
    prisma,
    messages,
    new GeminiOfferWriter(apiKey, process.env.GEMINI_MODEL),
  )
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
