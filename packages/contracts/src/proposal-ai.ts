import type { PathRequest } from './index';
export interface ProposalRequest extends PathRequest {
  revision: string;
  text: string;
  instruction: string;
  provider: 'ollama' | 'openai-compatible' | 'external-agent';
  port: number;
  chatModel: string;
  approved: true;
}
export interface ProposalResult { json: string; warnings: string[] }
