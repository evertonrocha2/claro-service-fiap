import { createHash } from 'node:crypto'
import type { Intent } from '@sync/contracts'
import type { Prisma, PrismaClient } from '@sync/db'
import type { ExtractedEntities } from './pii.js'

export type CachedClassification = {
  intent: Intent
  confidence: number
  entities: ExtractedEntities
}

export interface IIntentCacheRepository {
  find(redactedText: string): Promise<CachedClassification | null>
  save(redactedText: string, value: CachedClassification): Promise<void>
}

/**
 * A chave é o hash do texto **já redigido**, nunca o texto cru.
 *
 * Duas razões. Privacidade: o cache é uma tabela consultável e não deve guardar
 * CPF de ninguém. E acerto: "meu cpf é 111..." e "meu cpf é 222..." viram a mesma
 * chave depois da redação, então uma pessoa aproveita a classificação da outra.
 */
export function cacheKey(redactedText: string): string {
  return createHash('sha256').update(redactedText).digest('hex')
}

export class PrismaIntentCacheRepository implements IIntentCacheRepository {
  constructor(private readonly db: PrismaClient) {}

  async find(redactedText: string): Promise<CachedClassification | null> {
    const linha = await this.db.intentCache.findUnique({
      where: { textHash: cacheKey(redactedText) },
    })
    if (!linha) return null

    await this.db.intentCache.update({
      where: { id: linha.id },
      data: { hits: { increment: 1 } },
    })

    return {
      intent: linha.intent,
      confidence: linha.confidence,
      entities: (linha.entities ?? {}) as ExtractedEntities,
    }
  }

  async save(redactedText: string, value: CachedClassification): Promise<void> {
    const textHash = cacheKey(redactedText)
    const entities = value.entities as unknown as Prisma.InputJsonValue

    await this.db.intentCache.upsert({
      where: { textHash },
      update: { intent: value.intent, confidence: value.confidence, entities },
      create: { textHash, intent: value.intent, confidence: value.confidence, entities },
    })
  }
}
