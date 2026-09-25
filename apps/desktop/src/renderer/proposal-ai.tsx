import React, { useEffect, useRef, useState } from 'react';
import type { ProposalResult, Session } from '@metis/contracts';
export function ProposalGenerator({ session, path, base, busy, start, finish }: {
  session: Session; path: string; base?: { text: string; disk: { revision: string } }; busy: boolean;
  start(): void; finish(result?: ProposalResult, error?: string): void;
}) {
  const [provider, setProvider] = useState<'ollama' | 'openai-compatible' | 'external-agent'>('openai-compatible');
  const [port, setPort] = useState('8888'), [model, setModel] = useState(''), [instruction, setInstruction] = useState('');
  const [consent, setConsent] = useState(false), [running, setRunning] = useState(false);
  const serial = useRef(0);
  const [progress, setProgress] = useState('');
  const scope = () => ({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch });
  useEffect(() => { setConsent(false); }, [base, provider, port, model, instruction]);
  useEffect(() => () => { serial.current++; void window.metis.cancelProposal(scope()).catch(() => {}); }, []);
  async function generate() {
    if (!base || !consent) return;
    const token = ++serial.current; setConsent(false); setRunning(true); setProgress('요청 준비 중'); start();
    const request = { ...scope(), relativePath: path, revision: base.disk.revision, text: base.text, instruction, provider, port: Number(port), chatModel: provider === 'external-agent' ? 'external-agent' : model, approved: true as const };
    let polling = false;
    const timer = provider === 'external-agent' ? setInterval(async () => {
      if (polling) return; polling = true;
      try { const response = await window.metis.agentProgress({ ...scope(), operationId: request.requestId }); if (token === serial.current && response.ok) setProgress(response.value); }
      catch { /* The generation response remains authoritative. */ } finally { polling = false; }
    }, 400) : undefined;
    try {
      const response = await window.metis.generateProposal(request);
      if (token !== serial.current) return;
      if (response.ok) finish(response.value); else finish(undefined, response.error.message);
    } catch { if (token === serial.current) finish(undefined, '제안 생성 응답을 받지 못했습니다.'); }
    finally { clearInterval(timer); if (token === serial.current) setRunning(false); }
  }
  async function cancel() {
    // Keep generation locked until the main process acknowledges cancellation.
    setProgress('취소 요청 중 · 서버 응답을 기다립니다.');
    try { const response = await window.metis.cancelProposal(scope()); if (!response.ok) { setProgress('취소 확인 실패 · 작업은 진행 중일 수 있습니다. 다시 취소하거나 결과를 기다리세요.'); return; } }
    catch { setProgress('취소 확인 실패 · 작업은 진행 중일 수 있습니다. 다시 취소하거나 결과를 기다리세요.'); return; }
    serial.current++; setRunning(false); finish(undefined, '제안 생성을 취소했습니다.');
  }
  const valid = base && base.text.trim() && base.text.length <= 100000 && instruction.trim() && Number.isInteger(Number(port)) && Number(port) >= 1024 && Number(port) <= 65535 && (provider === 'external-agent' || /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$/.test(model));
  return <section aria-label="AI 제안 생성"><h3>AI 제안 생성</h3>
    <fieldset disabled={busy}><legend>요청별 전송 승인</legend>
      <label>제안 API<select value={provider} onChange={e => { setConsent(false); setProvider(e.target.value as typeof provider); }}><option value="openai-compatible">OpenAI 호환</option><option value="ollama">Ollama</option><option value="external-agent">외부 Agent</option></select></label>
      <label>제안 서버 포트<input value={port} onChange={e => { setConsent(false); setPort(e.target.value); }} /></label>
      {provider !== 'external-agent' && <label>제안 모델<input value={model} maxLength={120} onChange={e => { setConsent(false); setModel(e.target.value); }} /></label>}
      <label>변경 요청<input value={instruction} maxLength={2000} onChange={e => { setConsent(false); setInstruction(e.target.value); }} /></label>
      <p>전송 대상: http://127.0.0.1:{port}{provider === 'external-agent' ? '/metis/v1/proposals' : provider === 'openai-compatible' ? '/v1/chat/completions' : '/api/chat'}. 현재 문서 전체와 변경 요청을 전송합니다. 미저장 편집·주석·비활성 조건문도 포함합니다. 포함 파일은 읽지 않습니다. 원문 한도 100,000자.</p>
      {provider === 'external-agent' && <p>직접 실행한 Metis Agent 프로토콜 서버가 필요합니다. 문서의 상대 경로와 로컬 검증 결과도 전송합니다. Agent의 추가 전송·처리는 해당 서버 설정을 따릅니다. 취소는 연결을 종료하며 Agent의 별도 작업 종료를 보장하지 않습니다.</p>}
      <details><summary>전송할 원문 확인 ({base?.text.length ?? 0}자)</summary><pre>{base?.text}</pre></details>
      <label><input type="checkbox" checked={consent} disabled={!valid} onChange={e => setConsent(e.target.checked)} />서버·모델·변경 요청·전체 원문을 확인했고 이번 전송을 승인합니다.</label>
      <button disabled={!valid || !consent} onClick={generate}>AI 제안 생성</button>
    </fieldset>
    {running && <button onClick={cancel}>제안 생성 취소</button>}
    {running && <p role="status">{provider === 'external-agent' ? 'Agent 보고' : '제안 생성 진행'}: {progress}</p>}
  </section>;
}
