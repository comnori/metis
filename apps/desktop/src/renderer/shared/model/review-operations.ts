import type { Api, ContextBundle, Result, ScopedRequest } from '@metis/contracts';

type Work = 'buildContext' | 'queryAi' | 'semanticDiff' | 'generateProposal';
const cancellation: Record<Work, 'cancelContext' | 'cancelAi' | 'cancelSemanticDiff' | 'cancelProposal'> = {
  buildContext: 'cancelContext', queryAi: 'cancelAi', semanticDiff: 'cancelSemanticDiff', generateProposal: 'cancelProposal'
};
export interface ReviewJob { owner: string; label: string; method: Work; request: ScopedRequest; cancelled?: boolean }
interface OwnedJob extends ReviewJob { settled: Promise<void>; settle(): void }

/** Main currently shares workers and AI context. Keep ownership in one place. */
export class ReviewOperations {
  private job?: OwnedJob;
  private bundle?: { owner: string; id: string };
  private listeners = new Set<() => void>();
  private revision = 0;
  private closed = false;
  constructor(private api: Api) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  get active() { return this.job; }
  ownsBundle(owner: string, id: string) { return this.bundle?.owner === owner && this.bundle.id === id; }
  private emit() { this.revision++; this.listeners.forEach(fn => fn()); }
  forOwner(owner: string, label: string): Api {
    const coordinated = this;
    // contextBridge freezes API properties. An empty proxy target avoids violating
    // the invariants for non-configurable methods on that frozen object.
    return new Proxy({} as Api, { get(_target, key: keyof Api) {
      if (key in cancellation) return (request: ScopedRequest) => coordinated.run(owner, label, key as Work, request);
      const work = (Object.keys(cancellation) as Work[]).find(method => cancellation[method] === key);
      if (work) return (request: ScopedRequest) => coordinated.cancel(owner, work, request);
      const method = coordinated.api[key];
      return typeof method === 'function' ? method.bind(coordinated.api) : method;
    } });
  }
  private async run(owner: string, label: string, method: Work, request: ScopedRequest): Promise<Result<unknown>> {
    const failure = (code: 'BUSY' | 'CANCELLED' | 'INVALID_REQUEST', message: string): Result<unknown> => ({ ok: false, requestId: request.requestId, error: { code, message, retryable: true } });
    if (this.closed) return failure('CANCELLED', '작업 공간이 닫혔습니다.');
    if (this.job) return failure('BUSY', `${this.job.label}에서 작업 중입니다. 진행 위치에서 완료하거나 취소하세요.`);
    if (method === 'queryAi' && !this.ownsBundle(owner, (request as ScopedRequest & { bundleId: string }).bundleId)) return failure('INVALID_REQUEST', '검토한 맥락이 만료되었습니다. 이 탭에서 맥락을 다시 구성하세요.');
    let settle!: () => void;
    const settled = new Promise<void>(resolve => { settle = resolve; });
    const job: OwnedJob = { owner, label, method, request, settled, settle }; this.job = job;
    if (method === 'buildContext') this.bundle = undefined;
    this.emit();
    try {
      const result = await (this.api[method] as (value: ScopedRequest) => Promise<Result<unknown>>)(request);
      if (this.closed || this.job !== job || job.cancelled) return failure('CANCELLED', '종료된 작업의 응답입니다.');
      if (method === 'buildContext' && result.ok) this.bundle = { owner, id: (result.value as ContextBundle).createdAt };
      return result;
    } finally { if (this.job === job) { this.job = undefined; this.emit(); } job.settle(); }
  }
  private async cancel(owner: string, method: Work, request: ScopedRequest): Promise<Result<null>> {
    const job = this.job;
    // Unmounting an idle tab must never stop a different tab's shared worker.
    if (!job || job.owner !== owner || job.method !== method) return { ok: true, requestId: request.requestId, value: null };
    if (job.cancelled) { await job.settled; return { ok: true, requestId: request.requestId, value: null }; }
    job.cancelled = true;
    this.emit();
    try {
      const result = await this.api[cancellation[method]](request);
      // A cancellation acknowledgement can precede worker shutdown. Do not tell
      // the view it may retry while the original operation still owns the worker.
      if (result.ok) await job.settled;
      else { job.cancelled = false; this.emit(); }
      return result;
    } catch (error) { job.cancelled = false; this.emit(); throw error; }
  }
  async release(owner: string) {
    if (this.bundle?.owner === owner) { this.bundle = undefined; this.emit(); }
    const job = this.job;
    if (job?.owner === owner) await this.cancel(owner, job.method, job.request);
  }
  dispose() { this.closed = true; this.bundle = undefined; this.job = undefined; this.emit(); }
}
