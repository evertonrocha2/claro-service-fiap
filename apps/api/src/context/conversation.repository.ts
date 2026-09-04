import type { Channel, ConversationStatus, Intent } from '@sync/contracts'
import type { Conversation, Prisma, PrismaClient } from '@sync/db'
import { generateProtocol } from './protocol.js'

export type CreateConversationInput = {
  originChannel: Channel
  currentChannel: Channel
  customerId?: string
}

export type UpdateConversationInput = {
  customerId?: string
  currentChannel?: Channel
  intent?: Intent
  serviceId?: string
  status?: ConversationStatus
  stage?: string
  collectedData?: Record<string, unknown>
  consecutiveUnknown?: number
  firstResponseAt?: Date
  resolvedAt?: Date
}

export interface IConversationRepository {
  findById(id: string): Promise<Conversation | null>
  findByProtocol(protocol: string): Promise<Conversation | null>
  findOpenByCustomer(customerId: string): Promise<Conversation | null>
  create(input: CreateConversationInput): Promise<Conversation>
  update(id: string, patch: UpdateConversationInput): Promise<Conversation>
}

const MAX_TENTATIVAS_PROTOCOLO = 5

export class PrismaConversationRepository implements IConversationRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string): Promise<Conversation | null> {
    return this.db.conversation.findUnique({ where: { id } })
  }

  findByProtocol(protocol: string): Promise<Conversation | null> {
    return this.db.conversation.findUnique({ where: { protocol } })
  }

  /** "Aberta" é qualquer status diferente de RESOLVED. */
  findOpenByCustomer(customerId: string): Promise<Conversation | null> {
    return this.db.conversation.findFirst({
      where: { customerId, status: { not: 'RESOLVED' } },
      orderBy: { updatedAt: 'desc' },
    })
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    for (let tentativa = 0; tentativa < MAX_TENTATIVAS_PROTOCOLO; tentativa++) {
      try {
        return await this.db.conversation.create({
          data: { ...input, protocol: generateProtocol() },
        })
      } catch (erro) {
        const colisao =
          typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002'
        if (!colisao) throw erro
      }
    }
    throw new Error('não foi possível gerar um protocolo único')
  }

  update(id: string, patch: UpdateConversationInput): Promise<Conversation> {
    const { collectedData, ...resto } = patch
    // O tipo Json do Prisma nao aceita Record<string, unknown> direto. A conversao
    // e segura: collectedData e sempre um objeto simples, serializavel.
    const json = collectedData as Prisma.InputJsonValue | undefined
    return this.db.conversation.update({
      where: { id },
      data: json ? { ...resto, collectedData: json } : resto,
    })
  }
}
