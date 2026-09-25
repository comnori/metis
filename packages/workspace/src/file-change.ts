import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BoundaryError, type FileChangeRequest, type FileChangeApply, type FileChangePlan, type FileChangeResult, type DocumentSnapshot } from '@metis/contracts';
import type { Workspace } from './index';
import type { OperationRequest, OperationStatus, ScopedRequest } from '@metis/contracts';
import { setImmediate } from 'node:timers/promises';
type Edit = { id: string; from: number; to: number; replacement: string };
type Stored = { request: FileChangeRequest; plan: FileChangePlan; files: Map<string, DocumentSnapshot>; edits: Map<string, Edit[]>; created: number };
export class FileChanges {
  private stored?: Stored;
  private operation?: { request: ScopedRequest; status: OperationStatus; cancelled: boolean; review: boolean };
  constructor(private workspace: Workspace) {}
  status(request: OperationRequest): OperationStatus {
    const op = this.operation;
    if (!op || op.request.requestId !== request.operationId || op.request.workspaceId !== request.workspaceId || op.request.workspaceEpoch !== request.workspaceEpoch) throw new BoundaryError('CANCELLED', '해당 작업 상태가 만료되었습니다.');
    return { ...op.status };
  }
  cancel(request: OperationRequest) {
    this.status(request);
    if (!this.operation!.review) throw new BoundaryError('BUSY', '파일 적용은 중단할 수 없습니다. 항목별 결과를 기다려 주세요.');
    this.operation!.cancelled = true; this.stored = undefined; return null;
  }
  finish() { if (this.operation) this.operation.status.phase = 'finished'; }
  async preview(request: FileChangeRequest): Promise<FileChangePlan> {
    this.stored = undefined;
    const operation = { request, status: { phase: 'review' as const, completed: 0 }, cancelled: false, review: true }; this.operation = operation;
    const check = () => { if (operation.cancelled) throw new BoundaryError('CANCELLED', '영향 검토를 중단했습니다. 원본은 변경하지 않았습니다.'); };
    if (request.action === 'move' && request.relativePath.toLowerCase() === request.destination.toLowerCase()) throw new BoundaryError('INVALID_REQUEST', '다른 경로를 지정해 주세요. 대소문자만 바꾸는 작업은 아직 지원하지 않습니다.');
    const source = await this.workspace.read(request);
    check();
    const plan: FileChangePlan = { id: randomUUID(), relativePath: request.relativePath, destination: request.destination, action: request.action, impacts: [], scanned: 0,
      warnings: ['제한된 정적 문법 검토입니다. 속성·확장·동적 경로의 전체 영향을 보장하지 않습니다. 코드 예제·비활성 조건의 후보도 포함될 수 있으므로 변경할 항목을 직접 선택하세요.'] };
    const files = new Map<string, DocumentSnapshot>([[source.relativePath, source]]), edits = new Map<string, Edit[]>();
    const queue = ['']; let directories = 0, bytes = 0; const started = Date.now();
    const same = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
    while (queue.length && directories++ < 128 && plan.scanned < 200 && bytes < 32 * 1024 * 1024 && Date.now() - started < 8000 && plan.impacts.length < 500) {
      try {
        for (const entry of await this.workspace.list({ ...request, relativePath: queue.shift()! })) {
          check();
          if (entry.name.startsWith('.')) continue;
          if (entry.kind === 'directory') { queue.push(entry.relativePath); continue; }
          if (plan.scanned >= 200 || bytes >= 32 * 1024 * 1024 || plan.impacts.length >= 500 || Date.now() - started >= 8000) { plan.warnings.push('검토 한도에 도달해 일부 파일만 확인했습니다.'); break; }
          try {
            const file = same(entry.relativePath, source.relativePath) ? source : await this.workspace.read({ ...request, relativePath: entry.relativePath });
            check();
            files.set(file.relativePath, file); plan.scanned++; bytes += file.byteLength;
            operation.status.completed = plan.scanned;
            const text = file.text.replace(/\r\n|\r/g, '\n');
            let previousOffset = 0, line = 1, matches = 0;
            for (const match of text.matchAll(/(?:include::|xref:)([^\s\[]+)\[|<<([^\s,>]+)(?:,|>>)/g)) {
              if (++matches % 32 === 0) { await setImmediate(); check(); }
              if (Date.now() - started >= 8000) break;
              line += text.slice(previousOffset, match.index).split('\n').length - 1; previousOffset = match.index!;
              if (plan.impacts.length >= 500) break;
              const target = match[1] ?? match[2];
              if (target.length > 4096) { if (!plan.warnings.includes('너무 긴 경로 후보를 제외했습니다.')) plan.warnings.push('너무 긴 경로 후보를 제외했습니다.'); continue; }
              if (/[{}%\\:]/.test(target)) { if (!plan.warnings.includes('속성·외부 경로 후보는 자동 변경에서 제외했습니다.')) plan.warnings.push('속성·외부 경로 후보는 자동 변경에서 제외했습니다.'); continue; }
              const [filename, ...fragments] = target.split('#'); if (!/\.adoc$/i.test(filename) || filename.startsWith('/')) continue;
              const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.relativePath), filename));
              if (resolved.startsWith('../') || resolved === '..') continue;
              const incoming = same(resolved, source.relativePath), outgoing = same(file.relativePath, source.relativePath);
              if (!incoming && !outgoing) continue;
              const newSource = outgoing && request.action === 'move' ? request.destination : file.relativePath;
              const newTarget = incoming && request.action === 'move' ? request.destination : resolved;
              const replacement = (path.posix.relative(path.posix.dirname(newSource), newTarget) || path.posix.basename(newTarget)) + (fragments.length ? '#' + fragments.join('#') : '');
              const from = match.index! + match[0].indexOf(target), to = from + target.length;
              const lineStart = text.lastIndexOf('\n', from - 1) + 1, lineEnd = text.indexOf('\n', to);
              const snippetStart = Math.max(lineStart, from - 100), snippetEnd = Math.min(lineEnd < 0 ? text.length : lineEnd, to + 160);
              const before = text.slice(snippetStart, snippetEnd);
              const id = randomUUID(), canEdit = request.action === 'move' && replacement !== target && file.eol !== 'mixed' && !file.readOnly;
              plan.impacts.push({ id, relativePath: file.relativePath, line, target, before, after: canEdit ? text.slice(snippetStart, from) + replacement + text.slice(to, snippetEnd) : undefined });
              if (canEdit) { const list = edits.get(file.relativePath) ?? []; list.push({ id, from, to, replacement }); edits.set(file.relativePath, list); }
            }
          } catch (error) { check(); plan.warnings.push(`${entry.relativePath}: 읽기 실패로 제외했습니다.`); }
        }
      } catch (error) { check(); plan.warnings.push('일부 폴더에 접근하지 못했습니다.'); }
    }
    if (queue.length) plan.warnings.push('하위 폴더 검토가 완료되지 않았습니다.');
    if (directories >= 128 || plan.scanned >= 200 || bytes >= 32 * 1024 * 1024 || plan.impacts.length >= 500 || Date.now() - started >= 8000) plan.warnings.push('폴더·문서·원문·후보·시간 한도에 도달했습니다. 전체 영향 검토가 아닙니다.');
    check(); this.stored = { request, plan, files, edits, created: Date.now() }; this.finish();
    return plan;
  }
  async apply(request: FileChangeApply): Promise<FileChangeResult> {
    this.operation = { request, status: { phase: 'checking', completed: 0 }, cancelled: false, review: false };
    const stored = this.stored; this.stored = undefined;
    if (!stored || stored.plan.id !== request.planId || Date.now() - stored.created > 10 * 60_000 || stored.request.workspaceId !== request.workspaceId || stored.request.workspaceEpoch !== request.workspaceEpoch) throw new BoundaryError('CONFLICT', '검토가 만료되었거나 작업 공간이 변경되었습니다. 다시 검토해 주세요.');
    const available = new Set([...stored.edits.values()].flat().map(edit => edit.id));
    if (request.selected.some(id => !available.has(id))) throw new BoundaryError('INVALID_REQUEST', '검토에 없는 변경 항목입니다.');
    this.operation.status.total = stored.files.size;
    for (const [relativePath, file] of stored.files) {
      if ((await this.workspace.read({ ...request, relativePath })).revision !== file.revision) throw new BoundaryError('CONFLICT', `${relativePath}: 검토 이후 변경되었습니다. 다시 검토해 주세요.`);
      this.operation.status.completed++;
    }
    const result: FileChangeResult = { items: [], changed: false };
    const source = stored.files.get(stored.request.relativePath)!;
    this.operation.status = { phase: 'writing', completed: 0, total: 1 + stored.edits.size };
    try {
      const retained = await this.workspace.relocate({ ...request, relativePath: source.relativePath }, source.revision, stored.request.destination);
      result.changed = true; result.items.push({ relativePath: source.relativePath, state: 'done', message: stored.request.action === 'delete' ? `삭제했습니다. 복구 사본과 ${path.basename(retained)}에 원본을 보존했습니다.` : `${stored.request.destination}로 이동했습니다.` });
      this.operation.status.completed++;
    } catch (error) {
      result.changed = true; result.items.push({ relativePath: source.relativePath, state: 'failed', message: error instanceof Error ? error.message : '파일 작업 실패. 원본·대상·복구 사본을 확인해 주세요.' });
      for (const [relativePath, edits] of stored.edits) if (edits.some(edit => request.selected.includes(edit.id))) result.items.push({ relativePath, state: 'skipped', message: '원본 작업 실패로 선택한 경로 변경을 실행하지 않았습니다.' });
      return result;
    }
    for (const [original, edits] of stored.edits) {
      const selected = edits.filter(edit => request.selected.includes(edit.id)).sort((a, b) => b.from - a.from);
      if (!selected.length) { result.items.push({ relativePath: original, state: 'skipped', message: '선택하지 않은 참조·포함은 유지했습니다.' }); this.operation.status.completed++; continue; }
      const file = stored.files.get(original)!; let text = file.text.replace(/\r\n|\r/g, '\n');
      for (const edit of selected) text = text.slice(0, edit.from) + edit.replacement + text.slice(edit.to);
      const relativePath = original === source.relativePath ? stored.request.destination : original;
      try { await this.workspace.save({ ...request, relativePath, revision: file.revision, text }); result.items.push({ relativePath, state: 'done', message: `선택한 ${selected.length}개 경로를 갱신했습니다.` }); }
      catch (error) { result.items.push({ relativePath, state: 'failed', message: error instanceof Error ? error.message : '갱신 실패' }); }
      this.operation.status.completed++;
    }
    return result;
  }
}
