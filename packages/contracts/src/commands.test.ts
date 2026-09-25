import { expect, test } from 'vitest';
import { executeCommand, findCommands, type Command } from './commands';
test('search matches all words across label and stable command ID', () => {
  const commands: Command[] = [{ id: 'document.save', label: '문서 저장', reason: () => undefined, run() {} }, { id: 'workspace.open', label: '폴더 열기', reason: () => '먼저 확인', run() {} }];
  expect(findCommands(commands, '문서 SAVE')).toEqual([commands[0]]); expect(findCommands(commands, '')).toEqual(commands); expect(findCommands(commands, '없음')).toEqual([]);
});
test('execution rechecks changed context and refuses disabled or missing commands', async () => {
  let blocked = false, calls = 0;
  const commands: Command[] = [{ id: 'save', label: '저장', reason: () => blocked ? '읽기 전용' : undefined, run() { calls++; } }];
  expect(await executeCommand(commands, 'save')).toBeUndefined(); blocked = true;
  expect(await executeCommand(commands, 'save')).toBe('읽기 전용'); expect(calls).toBe(1); expect(await executeCommand(commands, 'unknown')).toContain('찾을 수 없습니다');
});
test('async command failures produce a result without a rejected promise', async () => {
  expect(await executeCommand([{ id: 'test', label: '테스트', reason: () => undefined, run: async () => { throw Error('failed'); } }], 'test')).toContain('완료하지 못했습니다');
});
