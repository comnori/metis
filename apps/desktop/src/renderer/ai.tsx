import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AiResult, ContextBundle, Session, SourceLocation } from '@metis/contracts';
import { aiCorpus } from '@metis/knowledge-index/ai-corpus';

export function AiSearch({ bundle, session, source }: { bundle: ContextBundle; session: Session; source(where: SourceLocation): React.ReactNode }) {
  const corpus = useMemo(() => aiCorpus(bundle), [bundle]);
  const [provider, setProvider] = useState<'ollama' | 'openai-compatible'>('ollama');
  const [separate, setSeparate] = useState(false), [embeddingPort, setEmbeddingPort] = useState('11434'), [embeddingProvider, setEmbeddingProvider] = useState<'ollama' | 'openai-compatible'>('ollama');
  const [query, setQuery] = useState(''), [port, setPort] = useState('11434'), [embedding, setEmbedding] = useState(''), [chat, setChat] = useState('');
  const [approved, setApproved] = useState(false), [busy, setBusy] = useState(false), [result, setResult] = useState<AiResult>(), [message, setMessage] = useState('모델과 전송할 발췌를 확인하세요.');
  const serial = useRef(0);
  const scope = () => ({ requestId: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch });
  useEffect(() => () => { serial.current++; void window.metis.cancelAi(scope()).catch(() => {}); }, []);
  function change(action: () => void) { serial.current++; setApproved(false); setResult(undefined); action(); }
  function cancel() { serial.current++; setBusy(false); setApproved(false); setResult(undefined); setMessage('AI 요청을 취소했습니다. 이미 전달한 정보는 회수할 수 없습니다.'); void window.metis.cancelAi(scope()).catch(() => {}); }
  async function run() {
    const token = ++serial.current; setBusy(true); setResult(undefined); setApproved(false); setMessage('임베딩 검색과 근거 기반 응답을 요청하고 있습니다.');
    try {
      const response = await window.metis.queryAi({ ...scope(), bundleId: bundle.createdAt, query, port: Number(port), provider, ...(separate ? { embeddingPort: Number(embeddingPort), embeddingProvider } : {}), embeddingModel: embedding, chatModel: chat, approved: true });
      if (token !== serial.current) return;
      if (response.ok) { setResult(response.value); setMessage('AI 조회 완료 · 원본 변경 없음'); } else setMessage(response.error.message);
    } catch { if (token === serial.current) setMessage('AI 응답을 받지 못했습니다.'); }
    finally { if (token === serial.current) setBusy(false); }
  }
  return <section aria-label="AI 의미 검색"><h3>선택적 AI 의미 검색 · 문서 질의</h3>
    <p>사용자가 실행한 로컬 AI 서버(127.0.0.1)에 전송합니다. 서버의 모델·중계 설정에 따라 외부에서 처리될 수 있습니다. 모델 설치·다운로드는 자동 실행하지 않습니다.</p>
    <fieldset disabled={busy}><legend>이번 요청의 모델과 전송 범위</legend>
      <label>서버 API<select aria-label="서버 API" value={provider} onChange={e => change(() => setProvider(e.target.value as typeof provider))}><option value="ollama">Ollama /api</option><option value="openai-compatible">OpenAI 호환 /v1</option></select></label>
      <p>응답 전송 주소: http://127.0.0.1:{port}/{provider === 'ollama' ? 'api' : 'v1'}</p>
      <label>서버 포트<input type="number" min={1024} max={65535} value={port} onChange={e => change(() => setPort(e.target.value))} /></label>
      <label><input type="checkbox" checked={separate} onChange={e => change(() => setSeparate(e.target.checked))} />임베딩 서버 별도 지정</label>
      {separate && <div><label>임베딩 API<select aria-label="임베딩 API" value={embeddingProvider} onChange={e => change(() => setEmbeddingProvider(e.target.value as typeof embeddingProvider))}><option value="ollama">Ollama /api</option><option value="openai-compatible">OpenAI 호환 /v1</option></select></label><label>임베딩 서버 포트<input type="number" min={1024} max={65535} value={embeddingPort} onChange={e => change(() => setEmbeddingPort(e.target.value))} /></label></div>}
      <p>임베딩 전송 주소: http://127.0.0.1:{separate ? embeddingPort : port}/{(separate ? embeddingProvider : provider) === 'ollama' ? 'api' : 'v1'}</p>
      <label>임베딩 모델<input maxLength={120} value={embedding} onChange={e => change(() => setEmbedding(e.target.value))} /></label>
      <label>응답 모델<input maxLength={120} value={chat} onChange={e => change(() => setChat(e.target.value))} /></label>
      <label>AI 질의<input maxLength={300} value={query} onChange={e => change(() => setQuery(e.target.value))} /></label>
      <p>전송: 질의와 아래 발췌 {corpus.evidence.length}개를 임베딩 모델에, 검색된 상위 8개 이하의 발췌·경로·행·리비전·상위 문서와 질의를 응답 모델에 전달합니다. 현재 검토한 저장본 기준이며 자동 갱신하지 않습니다.</p>
      {corpus.truncated && <p>긴 발췌는 2,000자로 잘랐습니다.</p>}{corpus.error && <p>{corpus.error}</p>}
      <details><summary>전송 발췌 전체 검토</summary>{corpus.evidence.map(item => <article key={item.id}><p>{item.id} · {item.documentPath} · {item.relativePath}:{item.line} · {item.kind}</p><pre>{item.text}</pre></article>)}</details>
      <label><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />이 질의·발췌·모델·서버로 이번 요청 전송을 승인합니다.</label>
      <button disabled={!approved || !query.trim() || !embedding || !chat || !!corpus.error} onClick={run}>승인한 범위로 AI 조회</button>
    </fieldset>{busy && <button onClick={cancel}>AI 요청 취소</button>}<p role="status">{message}</p>
    {result && <section aria-label="AI 조회 결과"><h4>{result.status === 'insufficient' ? '근거 부족 · 답변 보류' : result.status === 'conflict' ? 'AI 추론 · 상충 후보' : 'AI 추론 · 인용 검토 필요'}</h4>
      {result.warnings.map(warning => <p key={warning}>{warning}</p>)}
      {result.claims.map((claim, i) => <article key={i}><p>{claim.text}</p>{claim.citations.map((citation, j) => { const item = result.evidence.find(e => e.id === citation.id)!; return <div key={j}><blockquote>{citation.quote}</blockquote><p>{citation.id} · 해석 기준 {item.documentPath}</p>{source({ relativePath: item.relativePath, line: item.sourceUncertain ? 1 : item.line })}</div>; })}</article>)}
      <details><summary>의미 검색 근거 · {result.evidence.length}개</summary>{result.evidence.map(item => <article key={item.id}><p>{item.id} · 유사도 {item.similarity.toFixed(3)} · {item.kind === 'explicit-relation' ? '명시적 관계 선언' : '모델 기반 추천'}</p><pre>{item.text}</pre><p>해석 기준 {item.documentPath} · 리비전 {item.revision}{item.sourceUncertain && ' · 위치 미확인'}</p>{source({ relativePath: item.relativePath, line: item.sourceUncertain ? 1 : item.line })}</article>)}</details>
    </section>}
  </section>;
}
