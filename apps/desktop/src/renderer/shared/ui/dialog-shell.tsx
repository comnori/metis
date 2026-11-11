import React, { useEffect, useId, useRef } from 'react';
import { openDialog, useSearchDialogEscape } from '../lib/accessibility';
import { useTaskCloseGuard } from '../model/workspace-tabs';
import './dialog-shell.css';

export interface DialogShellProps {
  title: string;
  ariaLabel?: string;
  description?: React.ReactNode;
  size?: 'small' | 'medium' | 'large';
  className?: string;
  children: React.ReactNode;
  auxiliary?: React.ReactNode;
  actions?: React.ReactNode;
  status?: React.ReactNode;
  canClose?: boolean;
  blockedReason?: string;
  close(): void;
  dialogRef?: React.RefObject<HTMLDialogElement | null>;
}

/** The body is the only scrolling region. All dismissal paths share one guard. */
export function DialogShell({ title, ariaLabel, description, size = 'large', className = '', children, auxiliary, actions, status, canClose = true, blockedReason, close, dialogRef }: DialogShellProps) {
  const ownRef = useRef<HTMLDialogElement>(null), ref = dialogRef ?? ownRef, titleId = useId();
  // Capture before the commit disables the invoking command or autofocus moves.
  const invoker = useRef(document.activeElement as HTMLElement | null);
  const dismiss = () => { if (canClose) close(); };
  const escape = useSearchDialogEscape(dismiss);
  useEffect(() => {
    const dispose = openDialog(ref.current!, invoker.current);
    ref.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
    return dispose;
  }, []);
  return <dialog {...escape} ref={ref} className={`dialog-shell dialog-${size} ${className}`} aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : titleId} onCancel={event => { event.preventDefault(); dismiss(); }}>
    <header className="dialog-header"><div><h2 id={titleId}>{title}</h2>{description && <div className="dialog-description">{description}</div>}</div><button type="button" className="dialog-dismiss" aria-label={`${ariaLabel ?? title} 닫기`} title={canClose ? '닫기 (Esc)' : blockedReason ?? '작업이 완료될 때까지 기다려 주세요.'} disabled={!canClose} onClick={dismiss}>×</button></header>
    <div className="dialog-body">{children}</div>
    <footer className="dialog-footer"><div className="dialog-auxiliary">{auxiliary}</div><div className="dialog-completion">{status && <span className="dialog-status" role="status">{status}</span>}<div className="dialog-actions">{actions ?? <button type="button" onClick={dismiss} disabled={!canClose}>닫기</button>}</div></div></footer>
    {!canClose && <div className="dialog-blocked" role="status">{blockedReason ?? '처리 중에는 닫을 수 없습니다. 완료 후 결과를 확인하세요.'}</div>}
  </dialog>;
}

export function TaskSurface({ title, close, children, actions, auxiliary, canClose = true, className = '' }: { title: string; close(): void; children: React.ReactNode; actions?: React.ReactNode; auxiliary?: React.ReactNode; canClose?: boolean; className?: string }) {
  useTaskCloseGuard(canClose);
  return <section className={`task-surface ${className}`}>
    <header className="task-header"><h2>{title}</h2><button type="button" onClick={close} disabled={!canClose}>닫기</button></header>
    {!canClose && <div className="dialog-blocked" role="status">처리 중입니다. 실행을 취소하거나 완료한 후 탭을 닫을 수 있습니다.</div>}
    <div className="task-body">{children}</div>
    {(actions || auxiliary) && <footer className="task-footer"><div className="dialog-auxiliary">{auxiliary}</div><div className="dialog-actions">{actions}</div></footer>}
  </section>;
}
