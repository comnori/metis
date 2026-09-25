import { utilityProcess, type UtilityProcess } from 'electron';
import { BoundaryError, type Analysis, type AnalyzeRequest, type Result, type ScopedRequest } from '@metis/contracts';
export class PreviewWorker<Request extends ScopedRequest = AnalyzeRequest, Value = Analysis> {
  private worker?: UtilityProcess;
  ready = false;
  private pending?: { root: string; request: Request; resolve(value: Value): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> };
  constructor(private entry: string, private kind = 'analyze', private timeout = 5000) { this.start(); }
  private start() {
    const worker = utilityProcess.fork(this.entry, [], { serviceName: this.kind === 'search' ? 'Metis Search' : 'Metis Preview' }); this.worker = worker;
    worker.on('message', message => {
      if (this.worker !== worker) return;
      if (message?.type === 'ready') { this.ready = true; this.send(); return; }
      if (message?.type !== 'analysis' || message.requestId !== this.pending?.request.requestId) return;
      const pending = this.pending!; this.pending = undefined; clearTimeout(pending.timer);
      const result = message.result as Result<Value>;
      if (result.ok) pending.resolve(result.value); else pending.reject(new BoundaryError(result.error.code, result.error.message));
    });
    worker.on('exit', () => { if (this.worker === worker) this.stop(`${this.kind === 'search' ? '검색' : '해석'} 프로세스가 종료되었습니다. 다시 요청해 주세요.`); });
  }
  private send() { if (this.ready && this.pending) this.worker?.postMessage({ type: this.kind, root: this.pending.root, request: this.pending.request }); }
  stop(message = this.kind === 'search' ? '이전 검색 요청을 취소했습니다.' : '이전 미리보기 요청을 취소했습니다.') {
    const worker = this.worker; this.worker = undefined; this.ready = false;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new BoundaryError('CANCELLED', message)); this.pending = undefined; }
    worker?.kill();
  }
  analyze(root: string, request: Request): Promise<Value> {
    if (this.pending) this.stop();
    if (!this.worker) this.start();
    return new Promise((resolve, reject) => {
      this.pending = { root, request, resolve, reject, timer: setTimeout(() => this.stop(`${this.kind === 'semantic-diff' ? '의미 비교' : this.kind === 'context' ? '맥락 구성' : this.kind === 'relations' ? '관계 조사' : this.kind === 'search' ? '검색' : '미리보기'} 제한 시간(${this.timeout / 1000}초)을 초과했습니다. 원문 편집은 계속할 수 있습니다.`), this.timeout) };
      this.send();
    });
  }
}
