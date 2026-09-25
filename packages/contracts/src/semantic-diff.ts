import type { PathRequest, SourceLocation, ValidationReport } from './index';
export interface SemanticDiffRequest extends PathRequest { before: string; after: string }
export interface SemanticUnit extends SourceLocation { category: 'section' | 'block' | 'attribute' | 'reference' | 'include' | 'condition'; key: string; value: string }
export interface SemanticChange { kind: 'added' | 'removed' | 'modified'; before?: SemanticUnit; after?: SemanticUnit }
export interface SemanticDiffResult { changes: SemanticChange[]; warnings: string[]; partial: boolean; truncated: boolean; validation?: { before?: ValidationReport; after?: ValidationReport } }
