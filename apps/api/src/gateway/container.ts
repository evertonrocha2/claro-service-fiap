import { prisma } from '@sync/db'
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
}

/** Raiz de composição. É o único lugar que instancia implementações concretas. */
export function buildContainer(): Container {
  const conversations = new PrismaConversationRepository(prisma)
  const messages = new PrismaMessageRepository(prisma)
  const customers = new PrismaCustomerRepository(prisma)
  const identity = new IdentityService(customers, conversations)

  return {
    orchestrator: new ConversationOrchestrator(
      identity,
      conversations,
      messages,
      customers,
      new RuleClassifier(),
    ),
  }
}
