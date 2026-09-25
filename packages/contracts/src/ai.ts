import type { ScopedRequest, SourceLocation } from './index';
export interface AiRequest extends ScopedRequest { bundleId: string; query: string; port: number; provider?: 'ollama' | 'openai-compatible'; embeddingPort?: number; embeddingProvider?: 'ollama' | 'openai-compatible'; embeddingModel: string; chatModel: string; approved: true }
export interface AiEvidence extends SourceLocation { id: string; documentPath: string; revision: string; text: string; kind: string; sourceUncertain: boolean }
export interface AiResult { status: 'answer' | 'insufficient' | 'conflict'; claims: Array<{ text: string; citations: Array<{ id: string; quote: string }> }>; evidence: Array<AiEvidence & { similarity: number }>; warnings: string[] }
