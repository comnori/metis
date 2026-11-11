import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Api } from '@metis/contracts';
import { ReviewOperations } from './review-operations';

export type ToolKind = 'graph' | 'git' | 'context' | 'evidence' | 'validation' | 'semantic' | 'proposal' | 'recovery' | 'help';
export type WorkspaceTab = { kind: 'document'; id: string; path: string; title: string } | { kind: ToolKind; id: string; title: string; path?: string };
export type ToolTab = Exclude<WorkspaceTab, { kind: 'document' }>;
export const toolTitles: Record<ToolKind, string> = { graph: '그래프·관계', git: 'Git 변경·이력', context: '문서 맥락', evidence: '문서 근거 탐색', validation: '문서 집합 검증', semantic: '의미·텍스트 비교', proposal: '변경 제안', recovery: '복구 사본', help: '도움말' };
export function makeToolTab(kind: ToolKind, path?: string): ToolTab {
  const perDocument = kind === 'semantic' || kind === 'proposal';
  return { kind, id: perDocument ? `${kind}:${path ?? ''}` : kind, title: `${toolTitles[kind]}${perDocument && path ? ` · ${path.split('/').at(-1)}` : ''}`, path };
}
const TaskContext = createContext<{ active: boolean; owner: string; api: Api; operations: ReviewOperations; setCanClose(value: boolean): void } | undefined>(undefined);
export function TaskProvider({ tab, active, operations, setCanClose, children }: { tab: ToolTab; active: boolean; operations: ReviewOperations; setCanClose(value: boolean): void; children: React.ReactNode }) {
  const api = useMemo(() => operations.forOwner(tab.id, tab.title), [operations, tab.id]);
  useEffect(() => () => { void operations.release(tab.id).catch(() => {}); }, [operations, tab.id]);
  return <TaskContext.Provider value={{ active, owner: tab.id, api, operations, setCanClose }}>{children}</TaskContext.Provider>;
}
export function useReviewApi() { return useContext(TaskContext)?.api ?? window.metis; }
export function useTaskActive() { return useContext(TaskContext)?.active ?? true; }
export function useReviewJob() {
  const task = useContext(TaskContext);
  useSyncExternalStore(task?.operations.subscribe ?? (() => () => {}), task?.operations.snapshot ?? (() => 0));
  return task?.operations.active;
}
export function useTaskCloseGuard(canClose: boolean) {
  const task = useContext(TaskContext);
  useEffect(() => { task?.setCanClose(canClose); }, [canClose, task?.setCanClose]);
}
export function useBundleCurrent(id?: string) {
  const task = useContext(TaskContext);
  useSyncExternalStore(task?.operations.subscribe ?? (() => () => {}), task?.operations.snapshot ?? (() => 0));
  return !task || !id || task.operations.ownsBundle(task.owner, id);
}
