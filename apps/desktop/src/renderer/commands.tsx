import { openDialog } from './accessibility';
import { platformShortcut } from './accessibility';
import React, { useEffect, useRef, useState } from 'react';
import { findCommands, type Command } from '@metis/contracts';
import './recovery.css';
import './commands.css';
export function CommandPalette({ commands, close, execute }: { commands: Command[]; close(): void; execute(id: string): void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(0);
  const results = findCommands(commands, query), current = Math.min(selected, Math.max(0, results.length - 1));
  useEffect(() => { const node = dialog.current!; const restoreFocus = openDialog(node); input.current?.focus(); return () => { restoreFocus(); }; }, []);
  useEffect(() => { dialog.current?.querySelector(`[data-command-index="${current}"]`)?.scrollIntoView({ block: 'nearest' }); }, [current, query]);
  function run(command: Command) { if (command.reason()) return; dialog.current?.close(); close(); execute(command.id); }
  return <dialog ref={dialog} className="recovery-dialog command-palette" aria-label="명령 팔레트" onCancel={event => { event.preventDefault(); close(); }}>
    <h2>명령 팔레트</h2><p>↑↓ 선택 · Enter 실행 · Esc 닫기. 사용할 수 없는 명령은 이유를 표시합니다.</p>
    <label>명령 검색<input ref={input} role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={results.length ? `command-option-${current}` : undefined} autoComplete="off" value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setSelected(event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, results.length - 1) : results.length ? (current + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0); }
      if (event.key === 'Enter') { event.preventDefault(); if (results[current]) run(results[current]); }
    }} /></label>
    <ul id="command-results" role="listbox" aria-label="명령 목록">{results.map((command, index) => { const reason = command.reason(); return <li role="option" id={`command-option-${index}`} key={command.id} data-command-index={index} aria-selected={index === current} aria-disabled={!!reason} onMouseMove={() => setSelected(index)} onClick={() => run(command)}><strong>{command.label}</strong>{command.shortcut && <kbd>{platformShortcut(command.shortcut)}</kbd>}<small>{reason ?? '실행 가능'}</small></li>; })}</ul>
    {!results.length && <p role="status">일치하는 명령이 없습니다.</p>}<button onClick={close}>닫기</button>
  </dialog>;
}
