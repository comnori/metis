export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  reason(): string | undefined;
  run(): unknown | Promise<unknown>;
}
export function findCommands(commands: Command[], query: string): Command[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter(command => terms.every(term => `${command.label} ${command.id}`.toLocaleLowerCase().includes(term)));
}
export async function executeCommand(commands: Command[], id: string): Promise<string | undefined> {
  const command = commands.find(command => command.id === id);
  if (!command) return '명령을 찾을 수 없습니다.';
  const reason = command.reason(); if (reason) return reason;
  try { await command.run(); } catch { return '명령을 완료하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도하세요.'; }
}
