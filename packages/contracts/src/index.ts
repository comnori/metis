import type { ProposalRequest, ProposalResult } from './proposal-ai';
export type { ProposalRequest, ProposalResult } from './proposal-ai';
export { parseProposal, selectProposal, type ProposedChange } from './proposals';
import type { AiRequest, AiResult } from './ai';
export type { AiRequest, AiResult, AiEvidence } from './ai';
import type { SemanticDiffRequest, SemanticDiffResult } from './semantic-diff';
export type { SemanticDiffRequest, SemanticDiffResult, SemanticUnit, SemanticChange } from './semantic-diff';
import type { ContextRequest, ContextBundle } from './context';
export type { ContextRequest, ContextBundle, ContextDocument, SemanticBlock, ValidationIssue, ValidationReport } from './context';
export const protocolVersion = 1;
export { textDiff } from './diff';
export { findCommands, executeCommand, type Command } from './commands';
export { ExtensionRuntime, type ExtensionApi, type ExtensionDefinition, type ExtensionModel, type ExtensionViewData } from './extensions';
export const channels = {
  agentProgress: 'metis:agent-progress',
  generateProposal: 'metis:generate-proposal', cancelProposal: 'metis:cancel-proposal',
  queryAi: 'metis:query-ai', cancelAi: 'metis:cancel-ai',
  semanticDiff: 'metis:semantic-diff', cancelSemanticDiff: 'metis:cancel-semantic-diff',
  buildContext: 'metis:build-context', cancelContext: 'metis:cancel-context',
  configureEditor: 'metis:configure-editor', externalDecision: 'metis:external-decision', openExternal: 'metis:open-external', pendingLaunch: 'metis:pending-launch', applyLaunch: 'metis:apply-launch', dismissLaunch: 'metis:dismiss-launch',
  gitStatus: 'metis:git-status', gitFile: 'metis:git-file', gitVersion: 'metis:git-version',
  workspaceRelations: 'metis:workspace-relations', cancelRelations: 'metis:cancel-relations',
  fileOperationStatus: 'metis:file-operation-status', cancelFileReview: 'metis:cancel-file-review',
  previewFileChange: 'metis:preview-file-change', applyFileChange: 'metis:apply-file-change',
  copyDocument: 'metis:copy-document', checkpointDocument: 'metis:checkpoint-document', listRecovery: 'metis:list-recovery', readRecovery: 'metis:read-recovery',
  searchDocuments: 'metis:search-documents', cancelSearch: 'metis:cancel-search',
  analyzeDocument: 'metis:analyze-document',
  saveDocument: 'metis:save-document', createDocument: 'metis:create-document', confirmDiscard: 'metis:confirm-discard', recoveryFolder: 'metis:recovery-folder',
  openWorkspace: 'metis:open-workspace', closeWorkspace: 'metis:close-workspace',
  listDirectory: 'metis:list-directory', readDocument: 'metis:read-document', runtime: 'metis:runtime',
  createWorkspace: 'metis:create-workspace', createDirectory: 'metis:create-directory',
  recentWorkspaces: 'metis:recent-workspaces', openRecentWorkspace: 'metis:open-recent-workspace', removeRecentWorkspace: 'metis:remove-recent-workspace'
} as const;
export type Method = keyof typeof channels;
export type ErrorCode = 'INVALID_REQUEST' | 'NO_WORKSPACE' | 'STALE_WORKSPACE' | 'CANCELLED' | 'BUSY' |
  'NOT_FOUND' | 'CONFLICT' | 'ALREADY_EXISTS' | 'ACCESS_DENIED' | 'OUTSIDE_WORKSPACE' | 'UNSUPPORTED_FILE' | 'TOO_LARGE' | 'CHANGED_DURING_READ' | 'INTERNAL_ERROR';
export type Result<T> = { ok: true; requestId: string; value: T } |
  { ok: false; requestId: string; error: { code: ErrorCode; message: string; retryable: boolean } };
export interface Request { requestId: string }
export interface LaunchRequest extends Request { launchId: string }
export interface PendingLaunch { id: string; sameWorkspace: boolean; error?: string }
export interface LaunchResult { session: Session; relativePath: string; line: number }
export interface Session { viewKey?: string; workspaceId: string; workspaceEpoch: number; name: string; readOnly: boolean; warning?: string }
export interface NamedRequest extends Request { name: string }
export interface RecentRequest extends Request { recentId: string }
export interface CreateDirectoryRequest extends PathRequest { name: string }
export interface RecentWorkspace { id: string; name: string; path: string; openedAt: string; state: 'available' | 'missing' | 'unavailable' }
export interface RecentList { entries: RecentWorkspace[]; warning?: string }
export interface ScopedRequest extends Request { workspaceId: string; workspaceEpoch: number }
export interface PathRequest extends ScopedRequest { relativePath: string }
export interface GitVersionRequest extends PathRequest { commit: string }
export interface GitChange { relativePath: string; index: string; worktree: string }
export interface GitStatus { changes: GitChange[]; partial: boolean }
export interface GitCommit { id: string; date: string; subject: string }
export interface GitFile { relativePath: string; head?: string; staged?: string; disk?: DocumentSnapshot; history: GitCommit[]; warnings: string[] }
export interface GitVersion { relativePath: string; commit: string; text: string }
export interface SaveRequest extends PathRequest { revision: string; text: string }
export interface AnalyzeRequest extends PathRequest { text: string }
export interface FileChangeRequest extends PathRequest { action: 'move' | 'delete'; destination: string }
export interface FileChangeApply extends ScopedRequest { planId: string; selected: string[] }
export interface OperationRequest extends ScopedRequest { operationId: string }
export interface OperationStatus { phase: 'review' | 'checking' | 'writing' | 'finished'; completed: number; total?: number }
export interface FileImpact extends SourceLocation { id: string; before: string; after?: string; target: string }
export interface FileChangePlan { id: string; relativePath: string; destination: string; action: 'move' | 'delete'; impacts: FileImpact[]; warnings: string[]; scanned: number }
export interface FileChangeResult { items: Array<{ relativePath: string; state: 'done' | 'failed' | 'skipped'; message: string }>; changed: boolean }
export interface CopyRequest extends CreateDirectoryRequest { text: string }
export interface RecoveryRequest extends ScopedRequest { recoveryId: string; variant: 'before' | 'edited' | 'displaced' }
export interface RecoveryEntry { id: string; relativePath: string; createdAt: string; state: 'saved' | 'incomplete' | 'draft'; variants: Array<RecoveryRequest['variant']> }
export interface RecoveryList { entries: RecoveryEntry[]; warning?: string }
export interface RecoveryContent { relativePath: string; text: string }
export interface SearchRequest extends ScopedRequest { query: string; mode: 'text' | 'files' | 'symbols'; caseSensitive: boolean }
export interface SearchHit extends SourceLocation { kind: 'text' | 'file' | 'section' | 'anchor' | 'attribute'; label: string; context: string; revision?: string; documentPath: string }
export interface SearchResults { hits: SearchHit[]; scanned: number; partial: boolean; warnings: string[]; completedAt: string }
export interface SourceLocation { relativePath: string; line: number }
export interface OutlineEntry extends SourceLocation { id: string; title: string; level: number }
export interface Diagnostic extends SourceLocation { message: string }
export interface AnchorSymbol extends SourceLocation { id: string; title: string }
export interface Relation extends SourceLocation { kind: 'xref' | 'include'; target: string; state: 'resolved' | 'missing' | 'blocked' | 'unchecked'; destination?: SourceLocation; message?: string; sourceUncertain?: boolean }
export interface WorkspaceRelation extends Relation { documentPath: string; targetPath?: string; revision?: string }
export interface RelationIndex { edges: WorkspaceRelation[]; documents: string[]; scanned: number; partial: boolean; warnings: string[]; completedAt: string }
export interface AttributeDeclaration extends SourceLocation { name: string; value: string; applied: boolean }
export interface AttributeUse extends SourceLocation { name: string; value?: string }
export interface ConditionInfo extends SourceLocation { expression: string; state: 'active' | 'inactive' | 'unknown'; reason: string }
export interface Analysis { title?: string; html: string; outline: OutlineEntry[]; diagnostics: Diagnostic[]; anchors: AnchorSymbol[]; targetAnchors: Array<AnchorSymbol & { documentPath: string }>; relations: Relation[]; attributes: AttributeDeclaration[]; attributeUses: AttributeUse[]; conditions: ConditionInfo[]; files: string[] }
export interface Entry { name: string; relativePath: string; kind: 'directory' | 'document' }
export interface DocumentSnapshot { relativePath: string; text: string; revision: string; byteLength: number; bom: boolean; eol: 'lf' | 'crlf' | 'cr' | 'mixed' | 'none'; readOnly?: boolean }
export interface Runtime { protocolVersion: number; workerReady: boolean }
export interface Api {
  agentProgress(request: OperationRequest): Promise<Result<string>>;
  generateProposal(request: ProposalRequest): Promise<Result<ProposalResult>>;
  cancelProposal(request: ScopedRequest): Promise<Result<null>>;
  queryAi(request: AiRequest): Promise<Result<AiResult>>;
  cancelAi(request: ScopedRequest): Promise<Result<null>>;
  semanticDiff(request: SemanticDiffRequest): Promise<Result<SemanticDiffResult>>;
  cancelSemanticDiff(request: ScopedRequest): Promise<Result<null>>;
  buildContext(request: ContextRequest): Promise<Result<ContextBundle>>;
  cancelContext(request: ScopedRequest): Promise<Result<null>>;
  configureEditor(request: Request): Promise<Result<string>>;
  externalDecision(request: Request): Promise<Result<'save' | 'disk' | 'cancel'>>;
  openExternal(request: PathRequest): Promise<Result<null>>;
  pendingLaunch(request: Request): Promise<Result<PendingLaunch | null>>;
  applyLaunch(request: LaunchRequest): Promise<Result<LaunchResult>>;
  dismissLaunch(request: LaunchRequest): Promise<Result<null>>;
  gitStatus(request: ScopedRequest): Promise<Result<GitStatus>>;
  gitFile(request: PathRequest): Promise<Result<GitFile>>;
  gitVersion(request: GitVersionRequest): Promise<Result<GitVersion>>;
  workspaceRelations(request: ScopedRequest): Promise<Result<RelationIndex>>;
  cancelRelations(request: ScopedRequest): Promise<Result<null>>;
  fileOperationStatus(request: OperationRequest): Promise<Result<OperationStatus>>;
  cancelFileReview(request: OperationRequest): Promise<Result<null>>;
  previewFileChange(request: FileChangeRequest): Promise<Result<FileChangePlan>>;
  applyFileChange(request: FileChangeApply): Promise<Result<FileChangeResult>>;
  copyDocument(request: CopyRequest): Promise<Result<DocumentSnapshot>>;
  checkpointDocument(request: AnalyzeRequest): Promise<Result<string>>;
  listRecovery(request: ScopedRequest): Promise<Result<RecoveryList>>;
  readRecovery(request: RecoveryRequest): Promise<Result<RecoveryContent>>;
  searchDocuments(request: SearchRequest): Promise<Result<SearchResults>>;
  cancelSearch(request: ScopedRequest): Promise<Result<null>>;
  analyzeDocument(request: AnalyzeRequest): Promise<Result<Analysis>>;
  saveDocument(request: SaveRequest): Promise<Result<DocumentSnapshot>>;
  createDocument(request: CreateDirectoryRequest): Promise<Result<DocumentSnapshot>>;
  confirmDiscard(request: Request): Promise<Result<boolean>>;
  recoveryFolder(request: Request): Promise<Result<null>>;
  openWorkspace(request: Request): Promise<Result<Session>>;
  closeWorkspace(request: ScopedRequest): Promise<Result<null>>;
  listDirectory(request: PathRequest): Promise<Result<Entry[]>>;
  readDocument(request: PathRequest): Promise<Result<DocumentSnapshot>>;
  runtime(request: Request): Promise<Result<Runtime>>;
  createWorkspace(request: NamedRequest): Promise<Result<Session>>;
  createDirectory(request: CreateDirectoryRequest): Promise<Result<Entry>>;
  recentWorkspaces(request: Request): Promise<Result<RecentList>>;
  openRecentWorkspace(request: RecentRequest): Promise<Result<Session>>;
  removeRecentWorkspace(request: RecentRequest): Promise<Result<null>>;
}
export class BoundaryError extends Error {
  constructor(public code: ErrorCode, message: string) { super(message); }
}
export function validFolderName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 120 &&
    name === name.trim() && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !/[. ]$/.test(name) &&
    name !== '.' && name !== '..' && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}
export function validate(method: Method, input: unknown): Request | ScopedRequest | PathRequest | NamedRequest | RecentRequest | CreateDirectoryRequest {
  const fail = () => { throw new BoundaryError('INVALID_REQUEST', '요청 형식이 올바르지 않습니다.'); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const value = input as Record<string, unknown>;
  if (method === 'generateProposal' && (value.approved !== true || typeof value.relativePath !== 'string' || !/\.adoc$/i.test(value.relativePath) || value.relativePath.split('/').some(p => p.toLowerCase() === '.git') || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 100000 || !value.text.isWellFormed() || /[\0\r]/.test(value.text) || typeof value.instruction !== 'string' || !value.instruction.trim() || value.instruction.length > 2000 || !value.instruction.isWellFormed() || /[\x00-\x1f]/.test(value.instruction) || !['ollama', 'openai-compatible', 'external-agent'].includes(String(value.provider)) || !Number.isInteger(value.port) || Number(value.port) < 1024 || Number(value.port) > 65535 || typeof value.chatModel !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$/.test(value.chatModel))) return fail();
  if (method === 'queryAi' && ('embeddingPort' in value || 'embeddingProvider' in value) && (!Number.isInteger(value.embeddingPort) || Number(value.embeddingPort) < 1024 || Number(value.embeddingPort) > 65535 || !['ollama', 'openai-compatible'].includes(String(value.embeddingProvider)))) return fail();
  if (method === 'queryAi' && (('provider' in value && !['ollama', 'openai-compatible'].includes(String(value.provider))) || value.approved !== true || typeof value.bundleId !== 'string' || value.bundleId.length > 80 || typeof value.query !== 'string' || !value.query.trim() || value.query.length > 300 || !value.query.isWellFormed() || /[\x00-\x1f]/.test(value.query) || !Number.isInteger(value.port) || Number(value.port) < 1024 || Number(value.port) > 65535 || [value.embeddingModel, value.chatModel].some(m => typeof m !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$/.test(m)))) return fail();
  if (['applyLaunch', 'dismissLaunch'].includes(method) && (typeof value.launchId !== 'string' || !/^[\w-]{1,80}$/.test(value.launchId))) return fail();
  if (method === 'semanticDiff' && (typeof value.relativePath !== 'string' || !/\.adoc$/i.test(value.relativePath) || value.relativePath.split('/').some(p => p.toLowerCase() === '.git') || [value.before, value.after].some(t => typeof t !== 'string' || t.length > 1024 * 1024 || t.includes('\0') || !t.isWellFormed()))) return fail();
  if (method === 'buildContext') {
    const validPaths = (items: unknown, max: number): items is string[] => Array.isArray(items) && items.length > 0 && items.length <= max && new Set(items).size === items.length && items.every(p => typeof p === 'string' && p.length <= 4096 && p.isWellFormed() && /\.adoc$/i.test(p) && p.split('/').every(validFolderName) && !p.split('/').some(part => part.toLowerCase() === '.git'));
    if (!validPaths(value.paths, 16) || !validPaths(value.roots, 4) || value.roots.some(p => !(value.paths as string[]).includes(p))) return fail();
  }
  if (method === 'gitVersion' && (typeof value.commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.commit))) return fail();
  if (['gitFile', 'gitVersion'].includes(method) && (typeof value.relativePath !== 'string' || !/\.adoc$/i.test(value.relativePath) || value.relativePath.split('/').some(part => part.toLowerCase() === '.git'))) return fail();
  const scoped = ['agentProgress', 'generateProposal', 'cancelProposal', 'queryAi', 'cancelAi', 'semanticDiff', 'cancelSemanticDiff', 'buildContext', 'cancelContext', 'openExternal', 'gitStatus', 'gitFile', 'gitVersion', 'workspaceRelations', 'cancelRelations', 'fileOperationStatus', 'cancelFileReview', 'previewFileChange', 'applyFileChange', 'copyDocument', 'checkpointDocument', 'listRecovery', 'readRecovery', 'searchDocuments', 'cancelSearch', 'closeWorkspace', 'listDirectory', 'readDocument', 'createDirectory', 'createDocument', 'saveDocument', 'analyzeDocument'].includes(method);
  const path = ['generateProposal', 'semanticDiff', 'openExternal', 'gitFile', 'gitVersion', 'previewFileChange', 'copyDocument', 'checkpointDocument', 'listDirectory', 'readDocument', 'createDirectory', 'createDocument', 'saveDocument', 'analyzeDocument'].includes(method);
  const named = ['copyDocument', 'createWorkspace', 'createDirectory', 'createDocument'].includes(method);
  const recent = method === 'openRecentWorkspace' || method === 'removeRecentWorkspace';
  const keys = ['requestId', ...(method === 'generateProposal' ? ['revision', 'text', 'instruction', 'provider', 'port', 'chatModel', 'approved'] : []), ...(method === 'queryAi' ? ['bundleId', 'query', 'port', 'embeddingModel', 'chatModel', 'approved', ...('provider' in value ? ['provider'] : []), ...('embeddingPort' in value ? ['embeddingPort', 'embeddingProvider'] : [])] : []), ...(method === 'semanticDiff' ? ['before', 'after'] : []), ...(method === 'buildContext' ? ['paths', 'roots'] : []), ...(['applyLaunch', 'dismissLaunch'].includes(method) ? ['launchId'] : []), ...(method === 'gitVersion' ? ['commit'] : []), ...(scoped ? ['workspaceId', 'workspaceEpoch'] : []), ...(path ? ['relativePath'] : []), ...(named ? ['name'] : []), ...(recent ? ['recentId'] : []), ...(method === 'saveDocument' ? ['revision', 'text'] : []), ...(['analyzeDocument', 'copyDocument', 'checkpointDocument'].includes(method) ? ['text'] : []), ...(method === 'searchDocuments' ? ['query', 'mode', 'caseSensitive'] : []), ...(method === 'readRecovery' ? ['recoveryId', 'variant'] : []), ...(method === 'previewFileChange' ? ['action', 'destination'] : []), ...(method === 'applyFileChange' ? ['planId', 'selected'] : []), ...(['agentProgress', 'fileOperationStatus', 'cancelFileReview'].includes(method) ? ['operationId'] : [])];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return fail();
  if (typeof value.requestId !== 'string' || !/^[\w-]{1,80}$/.test(value.requestId)) return fail();
  if (named && !validFolderName(value.name)) return fail();
  if (['agentProgress', 'fileOperationStatus', 'cancelFileReview'].includes(method) && (typeof value.operationId !== 'string' || !/^[\w-]{1,80}$/.test(value.operationId))) return fail();
  if (method === 'previewFileChange' && (!['move', 'delete'].includes(String(value.action)) || typeof value.destination !== 'string' || (value.action === 'delete' ? value.destination !== '' : !validDocumentPath(value.destination)) || !validDocumentPath(String(value.relativePath)))) return fail();
  if (method === 'applyFileChange' && (typeof value.planId !== 'string' || !/^[\w-]{1,80}$/.test(value.planId) || !Array.isArray(value.selected) || value.selected.length > 500 || value.selected.some(id => typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) || new Set(value.selected).size !== value.selected.length)) return fail();
  if (method === 'readRecovery' && (typeof value.recoveryId !== 'string' || !/^(save|draft)-[\w-]{1,80}$/.test(value.recoveryId) || !['before', 'edited', 'displaced'].includes(String(value.variant)))) return fail();
  if (['copyDocument', 'checkpointDocument'].includes(method) && (typeof value.text !== 'string' || value.text.length > 16 * 1024 * 1024 || value.text.includes('\0') || !value.text.isWellFormed())) return fail();
  if (method === 'copyDocument' && !/\.adoc$/i.test(String(value.name))) return fail();
  if (method === 'searchDocuments' && (typeof value.query !== 'string' || value.query.length > 200 || /[\x00-\x1f]/.test(value.query) || !value.query.isWellFormed() || !['text', 'files', 'symbols'].includes(String(value.mode)) || typeof value.caseSensitive !== 'boolean')) return fail();
  if (method === 'analyzeDocument' && (typeof value.text !== 'string' || value.text.length > 1024 * 1024 || value.text.includes('\0') || !value.text.isWellFormed())) return fail();
  if (method === 'createDocument' && !/\.adoc$/i.test(String(value.name))) return fail();
  if (method === 'saveDocument' && (typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision) || typeof value.text !== 'string' || value.text.length > 16 * 1024 * 1024 || value.text.includes('\0') || value.text.includes('\r') || !value.text.isWellFormed())) return fail();
  if (recent && (typeof value.recentId !== 'string' || !/^[\w-]{1,80}$/.test(value.recentId))) return fail();
  if (scoped && (typeof value.workspaceId !== 'string' || !/^[\w-]{1,80}$/.test(value.workspaceId) ||
    !Number.isSafeInteger(value.workspaceEpoch) || Number(value.workspaceEpoch) < 1)) return fail();
  if (path) {
    const p = value.relativePath;
    if (typeof p !== 'string' || p.length > 4096 || /[\\:\x00-\x1f]/.test(p) ||
      (p !== '' && p.split('/').some(part => !part || part === '.' || part === '..')) ||
      (['readDocument', 'saveDocument', 'analyzeDocument', 'checkpointDocument'].includes(method) && p === '')) return fail();
  }
  return input as Request | ScopedRequest | PathRequest;
}
export function validDocumentPath(value: string) { return value.length <= 4096 && /\.adoc$/i.test(value) && !/[\s#%{}\[\]]/.test(value) && value.split('/').every(validFolderName); }
export function failure(requestId: string, error: unknown): Result<never> {
  const e = error instanceof BoundaryError ? error : new BoundaryError('INTERNAL_ERROR', '요청을 처리하지 못했습니다.');
  return { ok: false, requestId, error: { code: e.code, message: e.message, retryable: ['BUSY', 'CHANGED_DURING_READ'].includes(e.code) } };
}
