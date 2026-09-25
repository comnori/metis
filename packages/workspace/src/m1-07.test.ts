import { afterEach, expect, test, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Workspace, FileChanges, Recovery } from './index';
import { validate, type FileChangeRequest } from '@metis/contracts';
const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-m1-07-')); roots.push(root);
  const workspaceRoot = path.join(root, 'workspace'), recoveryRoot = path.join(root, 'recovery'); await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, 'note.adoc'), '\uFEFF= Note\r\n\r\ninclude::part.adoc[]\r\n');
  await fs.writeFile(path.join(workspaceRoot, 'part.adoc'), '== Part');
  await fs.writeFile(path.join(workspaceRoot, 'index.adoc'), 'include::note.adoc[]\n\nxref:note.adoc#_note[Note]');
  const workspace = new Workspace(recoveryRoot), session = await workspace.open(workspaceRoot);
  const scope = { requestId: 'test', workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch };
  const request: FileChangeRequest = { ...scope, relativePath: 'note.adoc', action: 'move', destination: 'docs/renamed.adoc' };
  return { root, workspaceRoot, recoveryRoot, workspace, changes: new FileChanges(workspace), scope, request };
}
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) { if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('metis-m1-07-')) throw new Error('Cleanup boundary'); await fs.rm(root, { recursive: true, force: true }); } });
test('preview is read-only; selected incoming and outgoing paths update preserving BOM and CRLF', async () => {
  const f = await fixture(); const plan = await f.changes.preview(f.request);
  expect(plan.impacts).toHaveLength(3); expect(await fs.readFile(path.join(f.workspaceRoot, 'note.adoc'), 'utf8')).toContain('include::part.adoc[]');
  const result = await f.changes.apply({ ...f.scope, planId: plan.id, selected: plan.impacts.map(hit => hit.id) });
  expect(result.items.every(item => item.state === 'done')).toBe(true);
  await expect(fs.stat(path.join(f.workspaceRoot, 'note.adoc'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(path.join(f.workspaceRoot, 'docs/renamed.adoc'), 'utf8')).toBe('\uFEFF= Note\r\n\r\ninclude::../part.adoc[]\r\n');
  expect(await fs.readFile(path.join(f.workspaceRoot, 'index.adoc'), 'utf8')).toContain('xref:docs/renamed.adoc#_note[Note]');
});
test('deselected references are kept and separately reported', async () => {
  const f = await fixture(), plan = await f.changes.preview(f.request);
  const result = await f.changes.apply({ ...f.scope, planId: plan.id, selected: [] });
  expect(result.items.some(item => item.state === 'skipped')).toBe(true);
  expect(await fs.readFile(path.join(f.workspaceRoot, 'index.adoc'), 'utf8')).toContain('include::note.adoc[]');
});
test('deletion preserves source and leaves referring text unchanged', async () => {
  const f = await fixture(), plan = await f.changes.preview({ ...f.request, action: 'delete', destination: '' });
  expect(plan.impacts.every(hit => !hit.after)).toBe(true);
  const result = await f.changes.apply({ ...f.scope, planId: plan.id, selected: [] }); expect(result.items[0].state).toBe('done');
  const recovery = new Recovery(f.recoveryRoot), entries = (await recovery.list(f.workspaceRoot)).entries;
  expect((await recovery.read(f.workspaceRoot, entries[0].id, 'edited')).text).toContain('\uFEFF= Note\r\n');
  const metadata = JSON.parse(await fs.readFile(path.join(f.recoveryRoot, entries[0].id, 'transaction.json'), 'utf8'));
  expect(await fs.readFile(metadata.retained, 'utf8')).toContain('= Note');
});
test('changed reviewed file invalidates the plan before mutation', async () => {
  const f = await fixture(), plan = await f.changes.preview(f.request);
  await fs.writeFile(path.join(f.workspaceRoot, 'index.adoc'), 'new external content');
  await expect(f.changes.apply({ ...f.scope, planId: plan.id, selected: [] })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await fs.readFile(path.join(f.workspaceRoot, 'note.adoc'), 'utf8')).toContain('= Note');
});
test('existing destination is not overwritten', async () => {
  const f = await fixture(), plan = await f.changes.preview(f.request);
  await fs.writeFile(path.join(f.workspaceRoot, 'docs/renamed.adoc'), 'existing');
  const result = await f.changes.apply({ ...f.scope, planId: plan.id, selected: [] }); expect(result.items[0].state).toBe('failed');
  expect(await fs.readFile(path.join(f.workspaceRoot, 'docs/renamed.adoc'), 'utf8')).toBe('existing');
  expect(await fs.readFile(path.join(f.workspaceRoot, 'note.adoc'), 'utf8')).toContain('= Note');
});
test('failed destination publication restores source and keeps recovery data', async () => {
  const f = await fixture(), plan = await f.changes.preview(f.request);
  vi.spyOn(f.workspace, 'copy').mockRejectedValueOnce(new Error('Injected write failure'));
  const result = await f.changes.apply({ ...f.scope, planId: plan.id, selected: plan.impacts.map(hit => hit.id) });
  expect(result.items[0].state).toBe('failed'); expect(result.items.slice(1).every(item => item.state === 'skipped')).toBe(true);
  expect(await fs.readFile(path.join(f.workspaceRoot, 'note.adoc'), 'utf8')).toContain('= Note');
  expect((await new Recovery(f.recoveryRoot).list(f.workspaceRoot)).entries.length).toBeGreaterThan(0);
});
test('reference update failure is partial completion rather than rollback or full success', async () => {
  const f = await fixture(), plan = await f.changes.preview(f.request);
  vi.spyOn(f.workspace, 'save').mockRejectedValue(new Error('Injected reference conflict'));
  const result = await f.changes.apply({ ...f.scope, planId: plan.id, selected: plan.impacts.map(hit => hit.id) });
  expect(result.items[0].state).toBe('done'); expect(result.items.slice(1).every(item => item.state === 'failed')).toBe(true);
  expect(await fs.readFile(path.join(f.workspaceRoot, 'docs/renamed.adoc'), 'utf8')).toContain('= Note');
});
test('external write immediately before displacement is restored without loss', async () => {
  const f = await fixture(), plan = await f.changes.preview(f.request), rename = fs.rename.bind(fs);
  vi.spyOn(fs, 'rename').mockImplementationOnce(async (source, destination) => { await fs.writeFile(source, 'late external bytes'); return rename(source, destination); });
  const result = await f.changes.apply({ ...f.scope, planId: plan.id, selected: [] });
  expect(result.items[0].state).toBe('failed');
  expect(await fs.readFile(path.join(f.workspaceRoot, 'note.adoc'), 'utf8')).toBe('late external bytes');
  await expect(fs.stat(path.join(f.workspaceRoot, 'docs/renamed.adoc'))).rejects.toMatchObject({ code: 'ENOENT' });
});
test('concurrent destination creator wins without being overwritten', async () => {
  const f = await fixture(), plan = await f.changes.preview(f.request), copy = f.workspace.copy.bind(f.workspace);
  vi.spyOn(f.workspace, 'copy').mockImplementationOnce(async request => { await fs.writeFile(path.join(f.workspaceRoot, request.relativePath, request.name), 'concurrent target'); return copy(request); });
  const result = await f.changes.apply({ ...f.scope, planId: plan.id, selected: [] });
  expect(result.items[0].state).toBe('failed');
  expect(await fs.readFile(path.join(f.workspaceRoot, 'docs/renamed.adoc'), 'utf8')).toBe('concurrent target');
  expect(await fs.readFile(path.join(f.workspaceRoot, 'note.adoc'), 'utf8')).toContain('= Note');
});
test('plans are single-use and selected edit ids must come from preview', async () => {
  const f = await fixture(), plan = await f.changes.preview(f.request);
  await expect(f.changes.apply({ ...f.scope, planId: plan.id, selected: ['invented'] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.changes.apply({ ...f.scope, planId: plan.id, selected: [] })).rejects.toMatchObject({ code: 'CONFLICT' });
});
test('junction destination is blocked without removing source', async () => {
  const f = await fixture(), outside = path.join(f.root, 'outside'); await fs.mkdir(outside); await fs.symlink(outside, path.join(f.workspaceRoot, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const plan = await f.changes.preview({ ...f.request, destination: 'link/stolen.adoc' });
  const result = await f.changes.apply({ ...f.scope, planId: plan.id, selected: [] }); expect(result.items[0].state).toBe('failed');
  expect(await fs.readdir(outside)).toEqual([]);
});
test.each(['../escape.adoc', '/absolute.adoc', 'C:/outside.adoc', 'folder/{name}.adoc'])('rejects unsafe target %s', destination => {
  expect(() => validate('previewFileChange', { requestId: 'test', workspaceId: 'scope', workspaceEpoch: 1, relativePath: 'note.adoc', action: 'move', destination })).toThrow();
});

test('review cancellation discards the plan and preserves original bytes', async () => {
  const f = await fixture(), before = await fs.readFile(path.join(f.workspaceRoot, 'note.adoc'));
  const pending = f.changes.preview(f.request);
  const operation = { ...f.scope, operationId: f.request.requestId };
  expect(f.changes.status(operation)).toEqual({ phase: 'review', completed: 0 });
  expect(() => f.changes.cancel({ ...operation, operationId: 'different' })).toThrow();
  f.changes.cancel(operation);
  await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(await fs.readFile(path.join(f.workspaceRoot, 'note.adoc'))).toEqual(before);
  await expect(f.changes.apply({ ...f.scope, planId: 'absent', selected: [] })).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('late cancellation cannot cancel a newer review or a file application', async () => {
  const f = await fixture(), plan = await f.changes.preview({ ...f.request, requestId: 'new-review' });
  expect(() => f.changes.cancel({ ...f.scope, operationId: 'old-review' })).toThrow();
  const operation = { ...f.scope, operationId: 'apply' };
  const applying = f.changes.apply({ ...f.scope, requestId: 'apply', planId: plan.id, selected: [] });
  expect(f.changes.status(operation).phase).toBe('checking');
  expect(() => f.changes.cancel(operation)).toThrow(/중단할 수 없습니다/);
  await applying;
  const progress = f.changes.status(operation);
  expect(progress.completed).toBe(progress.total);
  f.changes.finish();
  expect(f.changes.status(operation).phase).toBe('finished');
});

test('cancel after review completion invalidates the reviewed plan', async () => {
  const f = await fixture(), plan = await f.changes.preview(f.request);
  f.changes.cancel({ ...f.scope, operationId: f.request.requestId });
  await expect(f.changes.apply({ ...f.scope, planId: plan.id, selected: [] })).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('operation IPC rejects unknown fields and invalid identifiers', () => {
  const request = { requestId: 'test', workspaceId: 'workspace', workspaceEpoch: 1, operationId: 'operation' };
  for (const method of ['fileOperationStatus', 'cancelFileReview'] as const) {
    expect(() => validate(method, { ...request, operationId: '../outside' })).toThrow();
    expect(() => validate(method, { ...request, extra: true })).toThrow();
  }
});
