import React, { useCallback } from 'react';
import type { Session, SourceLocation } from '@metis/contracts';
import type { DocumentsHandle } from './document-workspace';
import { TaskProvider, type ToolTab } from '../shared/model/workspace-tabs';
import { ReviewOperations } from '../shared/model/review-operations';
import { GitPanel } from '../features/git';
import { RecoveryPanel } from '../features/recovery';
import { ContextPanel } from '../features/context-inspection';
import { SemanticPanel } from '../features/semantic-diff';
import { ProposalPanel } from '../features/proposal';
import { Relations } from '../features/relations';
import { GettingStarted } from '../features/getting-started';

export function TaskWorkspace({ tab, active, operations, session, documents, documentPath, close, open, execute, showHints, setCanClose }: {
  tab: ToolTab; active: boolean; operations: ReviewOperations; session?: Session;
  documents: React.RefObject<DocumentsHandle | null>; documentPath?: string; close(): void;
  open(source: SourceLocation, revision?: string): void; execute(id: string): void; showHints(): void;
  setCanClose(id: string, allowed: boolean): void;
}) {
  const guard = useCallback((allowed: boolean) => setCanClose(tab.id, allowed), [tab.id, setCanClose]);
  const draft = (path: string) => documents.current?.draft(path);
  const restore: Parameters<typeof GitPanel>[0]['restore'] = (disk, text, expected) => documents.current?.restoreDraft(disk, text, expected) ?? Promise.resolve('편집기를 사용할 수 없습니다.');
  return <div className="tool-workspace" role="tabpanel" id={`tool-panel-${tab.id}`} aria-labelledby={`tool-tab-${tab.id}`} hidden={!active}>
    <TaskProvider tab={tab} active={active} operations={operations} setCanClose={guard}>
      {tab.kind === 'help' ? <GettingStarted workspace={session?.name} documentPath={documentPath} readOnly={session?.readOnly} close={close} showHints={showHints} execute={execute} /> : session && <>
        {tab.kind === 'graph' && <Relations embedded session={session} initialPath={tab.path} initialMode="graph" close={close} open={open} />}
        {tab.kind === 'git' && <GitPanel session={session} initialPath={tab.path} draft={draft} revision={path => documents.current?.revision(path)} restore={restore} close={close} />}
        {tab.kind === 'recovery' && <RecoveryPanel session={session} close={close} />}
        {(tab.kind === 'context' || tab.kind === 'evidence' || tab.kind === 'validation') && <ContextPanel session={session} initialPath={tab.path} evidenceOnly={tab.kind === 'evidence'} validationOnly={tab.kind === 'validation'} close={close} open={open} />}
        {tab.kind === 'semantic' && tab.path && <SemanticPanel session={session} path={tab.path} draft={() => draft(tab.path!)} close={close} />}
        {tab.kind === 'proposal' && tab.path && <ProposalPanel session={session} path={tab.path} draft={() => draft(tab.path!)} revision={() => documents.current?.revision(tab.path!)} restore={restore} close={close} />}
      </>}
    </TaskProvider>
  </div>;
}
