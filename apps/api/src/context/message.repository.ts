import type { Channel, Direction, Intent, Sender } from '@sync/contracts'
import type { Message, PrismaClient } from '@sync/db'

export type CreateMessageInput = {
  conversationId: string
  channel: Channel
  direction: Direction
  sender: Sender
  text: string
  intent?: Intent
  confidence?: number
}

export interface IMessageRepository {
  append(input: CreateMessageInput): Promise<Message>
  listByConversation(conversationId: string): Promise<Message[]>
}

export class PrismaMessageRepository implements IMessageRepository {
  constructor(private readonly db: PrismaClient) {}

  append(input: CreateMessageInput): Promise<Message> {
    return this.db.message.create({ data: input })
  }

  listByConversation(conversationId: string): Promise<Message[]> {
    return this.db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    })
  }
}
