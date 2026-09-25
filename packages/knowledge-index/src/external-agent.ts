import { request as httpRequest } from 'node:http';
import { BoundaryError, parseProposal, selectProposal, type ProposalRequest, type ProposalResult, type ValidationReport } from '@metis/contracts';

// One approved snapshot in, progress and one proposal out. No filesystem/tool RPC.
export async function requestAgent(input: ProposalRequest, validation: ValidationReport, signal: AbortSignal, progress: (message: string) => void): Promise<ProposalResult> {
  try {
    signal.throwIfAborted();
    return await new Promise<ProposalResult>((resolve, reject) => {
      const body = JSON.stringify({ version: 1, instruction: input.instruction, document: { relativePath: input.relativePath, text: input.text }, validation });
      const req = httpRequest({ hostname: '127.0.0.1', port: input.port, path: '/metis/v1/proposals', method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Accept: 'application/x-ndjson' } }, res => {
        if (res.statusCode !== 200 || !res.headers['content-type']?.startsWith('application/x-ndjson')) { res.resume(); reject(new Error('Agent의 HTTP 상태 또는 NDJSON 응답 형식이 올바르지 않습니다.')); return; }
        res.setEncoding('utf8'); let pending = '', bytes = 0, count = 0, result: ProposalResult | undefined;
        const consume = (line: string) => {
          if (!line.trim()) return;
          if (++count > 200 || result) throw new Error('Agent 이벤트 개수 또는 순서가 올바르지 않습니다.');
          const event = JSON.parse(line);
          if (event?.type === 'progress' && Object.keys(event).sort().join(',') === 'message,type' && typeof event.message === 'string' && event.message.trim() && event.message.length <= 300 && event.message.isWellFormed() && !/[\x00-\x1f]/.test(event.message)) { progress(event.message); return; }
          if (event?.type !== 'proposal' || Object.keys(event).sort().join(',') !== 'proposal,type') throw new Error('지원하지 않는 Agent 이벤트입니다.');
          const json = JSON.stringify(event.proposal), p = event.proposal;
          const empty = p && Object.keys(p).sort().join(',') === 'changes,version' && p.version === 1 && Array.isArray(p.changes) && p.changes.length === 0;
          if (!empty) { const changes = parseProposal(json, input.text); selectProposal(input.text, changes, changes.map(c => c.id)); }
          result = { json, warnings: ['외부 Agent의 제안입니다. 근거 인용과 변경 이유를 검토하세요. 진행 메시지는 Agent의 보고이며 실행 사실을 보증하지 않습니다.'] };
        };
        res.on('data', (chunk: string) => {
          try {
            bytes += Buffer.byteLength(chunk); if (bytes > 2 * 1024 * 1024) throw new Error('Agent 응답 한도 2 MiB를 초과했습니다.');
            pending += chunk;
            let end; while ((end = pending.indexOf('\n')) >= 0) { consume(pending.slice(0, end)); pending = pending.slice(end + 1); }
          } catch (error) { res.destroy(error as Error); }
        });
        res.on('error', reject);
        res.on('end', () => { try { consume(pending); signal.throwIfAborted(); if (!result) throw new Error('Agent가 최종 제안 없이 응답을 종료했습니다.'); resolve(result); } catch (error) { reject(error); } });
      });
      req.on('error', reject); req.end(body);
    });
  } catch (error) {
    if (signal.aborted) throw new BoundaryError('CANCELLED', 'Agent 요청이 취소되었거나 60초 제한을 초과했습니다.');
    throw new BoundaryError('INTERNAL_ERROR', error instanceof Error && !('code' in error) ? error.message.slice(0, 200) : 'Agent 연결이 끊겼거나 서버에 연결하지 못했습니다.');
  }
}
