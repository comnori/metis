import { describe, expect, it, vi } from 'vitest';
import type { Api, ContextRequest, SemanticDiffRequest } from '@metis/contracts';
import { ReviewOperations } from './review-operations';
const scope = { requestId: 'request', workspaceId: 'workspace', workspaceEpoch: 1 };
const context = { ...scope, paths: ['a.adoc'], roots: ['a.adoc'] } as ContextRequest;
const diff = { ...scope, relativePath: 'a.adoc', before: 'old', after: 'new' } as SemanticDiffRequest;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const success = (value: unknown = null) => ({ ok: true as const, requestId: scope.requestId, value });
describe('review operation ownership', () => {
  it('does not cancel another tab when an idle review tab closes', async () => {
    const pending = deferred<ReturnType<typeof success>>();
    const cancelSemanticDiff = vi.fn(async () => success());
    const operations = new ReviewOperations({ semanticDiff: () => pending.promise, cancelSemanticDiff } as unknown as Api);
    const a = operations.forOwner('a', '비교 A'), b = operations.forOwner('b', '비교 B');
    const task = a.semanticDiff(diff);
    await b.cancelSemanticDiff(scope); await operations.release('b');
    expect(cancelSemanticDiff).not.toHaveBeenCalled();
    expect((await b.semanticDiff(diff)).ok).toBe(false);
    pending.resolve(success({})); await task;
    expect(operations.active).toBeUndefined();
  });
  it('keeps the shared worker locked until cancellation settles the original work', async () => {
    const pending = deferred<ReturnType<typeof success>>();
    const cancelContext = vi.fn(async () => success());
    const operations = new ReviewOperations({ buildContext: () => pending.promise, cancelContext } as unknown as Api);
    const a = operations.forOwner('a', '맥락 A');
    const task = a.buildContext(context), cancelled = a.cancelContext(scope);
    expect(cancelContext).toHaveBeenCalledTimes(1); expect(operations.active?.owner).toBe('a');
    pending.resolve(success({ createdAt: 'first' })); expect((await task).ok).toBe(false);
    await cancelled;
    expect(operations.ownsBundle('a', 'first')).toBe(false);
    expect(operations.active).toBeUndefined();
  });
  it('marks older AI context as stale instead of silently submitting it', async () => {
    let id = 0;
    const queryAi = vi.fn(async () => success({}));
    const operations = new ReviewOperations({ buildContext: async () => success({ createdAt: String(++id) }), queryAi } as unknown as Api);
    const a = operations.forOwner('a', '근거'), b = operations.forOwner('b', '검증');
    await a.buildContext(context); expect(operations.ownsBundle('a', '1')).toBe(true);
    await b.buildContext(context); expect(operations.ownsBundle('a', '1')).toBe(false);
    const result = await a.queryAi({ ...scope, bundleId: '1' } as Parameters<Api['queryAi']>[0]);
    expect(result.ok).toBe(false); expect(queryAi).not.toHaveBeenCalled();
  });
  it('rejects late responses after the workspace changes', async () => {
    const pending = deferred<ReturnType<typeof success>>();
    const operations = new ReviewOperations({ buildContext: () => pending.promise } as unknown as Api);
    const task = operations.forOwner('a', '맥락').buildContext(context); operations.dispose();
    pending.resolve(success({ createdAt: 'late' })); expect((await task).ok).toBe(false);
    expect(operations.ownsBundle('a', 'late')).toBe(false);
  });
  it('wraps frozen Electron bridge methods without proxy invariant violations', async () => {
    const api = Object.freeze({ buildContext: async () => success({ createdAt: 'frozen' }), readDocument: async () => success({ text: 'source' }) });
    const operations = new ReviewOperations(api as unknown as Api);
    const owned = operations.forOwner('a', '맥락');
    expect((await owned.buildContext(context)).ok).toBe(true);
    expect((await owned.readDocument({ ...scope, relativePath: 'a.adoc' })).ok).toBe(true);
  });
});
