import type { Analysis, DocumentSnapshot, ScopedRequest, SourceLocation } from './index';
export interface ContextRequest extends ScopedRequest { paths: string[]; roots: string[] }
export interface SemanticBlock extends SourceLocation { kind: string; parent: number | null; title: string; text: string; sourceUncertain?: boolean }
export interface ContextDocument { documentPath: string; blocks: SemanticBlock[]; model: Omit<Analysis, 'html' | 'files' | 'targetAnchors'> }
export interface ContextBundle { version: 1; transport: 'local-only'; basis: 'saved'; createdAt: string; sources: Pick<DocumentSnapshot, 'relativePath' | 'revision' | 'byteLength' | 'text'>[]; documents: ContextDocument[]; warnings: string[]; validation: ValidationReport }

export interface ValidationIssue extends SourceLocation {
  id: string; documentPath: string; category: 'structure' | 'reference' | 'include' | 'attribute' | 'coverage';
  certainty: 'confirmed' | 'parser' | 'unchecked'; code: string; message: string; sourceUncertain: boolean;
}
export interface ValidationReport { issues: ValidationIssue[]; checkedDocuments: number; checkedReferences: number; partial: boolean; truncated: boolean }
