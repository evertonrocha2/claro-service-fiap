import type { Intent, Result } from '@sync/contracts'
import type { ExtractedEntities } from './pii.js'

export type ClassificationSource = 'RULES' | 'LLM' | 'CACHE'

export type Classification = {
  intent: Intent
  confidence: number
  entities: ExtractedEntities
  source: ClassificationSource
}

export type ClassifyInput = {
  text: string
}

export interface IIntentClassifier {
  classify(input: ClassifyInput): Promise<Result<Classification>>
}
