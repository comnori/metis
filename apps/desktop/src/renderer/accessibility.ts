/** Keep native dialog focus containment; restore only when no destination took focus. */
export function openDialog(node: HTMLDialogElement) {
  const invoker = document.activeElement as HTMLElement | null;
  node.showModal();
  return () => {
    node.close();
    requestAnimationFrame(() => {
      if (document.querySelector('dialog[open]')) return;
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected && !node.contains(active)) return;
      const usable = invoker?.isConnected && invoker.getClientRects().length && !invoker.closest('[hidden],[inert]') && !invoker.matches(':disabled');
      const target = usable ? invoker : document.querySelector<HTMLElement>('[data-focus-home]');
      target?.focus();
    });
  };
}
export function platformShortcut(shortcut: string) {
  return shortcut.replace('Ctrl/Cmd', /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl');
}
import { useRef, type KeyboardEvent } from 'react';

/** Opt-in for dismissible search dialogs; prevent native search-input clearing. */
export function useSearchDialogEscape(close: () => void) {
  const composing = useRef(false);
  return {
    onCompositionStartCapture: () => { composing.current = true; },
    onCompositionEndCapture: () => { composing.current = false; },
    onKeyDownCapture: (event: KeyboardEvent<HTMLDialogElement>) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) close();
    },
  };
}
