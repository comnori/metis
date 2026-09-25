import { validateContext } from './validation';
import { Workspace, fileError } from '@metis/workspace';
import { BoundaryError, validate, type ContextRequest, type ContextBundle, type DocumentSnapshot, type SemanticBlock } from '@metis/contracts';
import { analyze } from './index';
export async function buildContext(root: string, request: ContextRequest): Promise<ContextBundle> {
  validate('buildContext', request);
  const workspace = new Workspace(), session = await workspace.open(root);
  const read = async (relativePath: string) => { try { return await workspace.read({ requestId: 'context-read', ...session, relativePath }); } catch (error) { throw fileError(error); } };
  const sources = new Map<string, DocumentSnapshot>(); let bytes = 0;
  for (const relativePath of request.paths) {
    const snapshot = await read(relativePath);
    bytes += snapshot.byteLength;
    if (snapshot.byteLength > 1024 * 1024 || bytes > 4 * 1024 * 1024) throw new BoundaryError('TOO_LARGE', '맥락 원문 한도는 파일당 1 MiB, 선택 합계 4 MiB입니다.');
    sources.set(relativePath, snapshot);
  }
  const bundle: ContextBundle = { version: 1, transport: 'local-only', basis: 'saved', createdAt: '', sources: [...sources.values()].map(({ relativePath, revision, byteLength, text }) => ({ relativePath, revision, byteLength, text })), documents: [], validation: { issues: [], checkedDocuments: 0, checkedReferences: 0, partial: false, truncated: false }, warnings: [
    '저장본 기준입니다. 열린 문서의 미저장 편집은 포함하지 않습니다.',
    '외부 전송 없음. 결과는 로컬 메모리에만 유지하며 원본을 변경하지 않습니다.',
    '절·블록의 시작 출처와 원문을 제공합니다. 인라인·표 셀·목록 항목별 정확한 범위는 제공하지 않습니다.',
    '참조 대상은 자동으로 읽지 않습니다. 문서 검증은 선택한 저장본과 해석 결과만 사용하며, 선택하지 않은 포함은 차단합니다.',
    '선택 파일의 전체 원문도 포함합니다. 비활성 조건·포함 태그 밖의 내용은 해석 결과와 구분해 검토하세요.'
  ] };
  for (const documentPath of request.roots) {
    const blocks: SemanticBlock[] = [];
    const { html: _html, files: _files, targetAnchors: _targets, ...model } = await analyze(root, documentPath, sources.get(documentPath)!.text, false, true, { sources, blocks });
    bundle.documents.push({ documentPath, blocks, model });
  }
  // Reject a mixed-time bundle instead of presenting it as a current snapshot.
  for (const snapshot of sources.values()) {
    const current = await read(snapshot.relativePath);
    if (current.revision !== snapshot.revision) throw new BoundaryError('CHANGED_DURING_READ', '맥락 생성 중 원본이 바뀌었습니다. 다시 구성해 주세요.');
  }
  bundle.validation = validateContext(bundle);
  bundle.createdAt = new Date().toISOString();
  if (Buffer.byteLength(JSON.stringify(bundle)) > 8 * 1024 * 1024) throw new BoundaryError('TOO_LARGE', '맥락 결과 한도 8 MiB를 초과했습니다. 문서 범위를 줄여 주세요.');
  return bundle;
}
