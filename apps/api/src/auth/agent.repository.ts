import type { Agent, PrismaClient } from '@sync/db'

export interface IAgentRepository {
  findById(id: string): Promise<Agent | null>
  findByEmail(email: string): Promise<Agent | null>
}

export class PrismaAgentRepository implements IAgentRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string): Promise<Agent | null> {
    return this.db.agent.findUnique({ where: { id } })
  }

  findByEmail(email: string): Promise<Agent | null> {
    return this.db.agent.findUnique({ where: { email: email.trim().toLowerCase() } })
  }
}
