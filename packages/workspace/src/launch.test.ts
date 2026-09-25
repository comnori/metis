import { expect, test } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { parseLaunch, LaunchQueue } from './launch';
import { Workspace } from './index';
import { ExternalEditor } from './external';
import { validate } from '@metis/contracts';
test('CLI parses spaced paths, relative workspace and bounded line numbers', () => {
  const root = process.cwd(); expect(parseLaunch(['--workspace', 'my notes', '--file', 'sub/a b.adoc', '--line', '12'], root)).toEqual({ root: path.resolve(root, 'my notes'), relativePath: 'sub/a b.adoc', line: 12 }); expect(parseLaunch(['--smoke'], root)).toBeUndefined();
});
test('CLI rejects traversal, invalid flags, duplicate options and unsupported targets', () => {
  for (const args of [['--file', 'a.adoc'], ['--workspace', '.', '--file', '../a.adoc'], ['--workspace', '.', '--file', 'C:/a.adoc'], ['--workspace', '.', '--line', '0'], ['--workspace', '.', '--file', 'a.adoc', '--line', '1000001'], ['--workspace', '.', '--workspace', '.'], ['--eval', 'code'], ['--workspace', '.', '--file', 'a.exe'], ['--workspace', '.', '--file', '.git/a.adoc']]) expect(() => parseLaunch(args, process.cwd())).toThrow();
});
test('queue retains order, bounds pending requests and rejects expired IDs', () => {
  const queue = new LaunchQueue(); queue.add(['--bad'], process.cwd()); expect(queue.peek()?.error).toBeTruthy(); const first = queue.peek()!.id; queue.take(first); expect(() => queue.take(first)).toThrow();
  for (let i = 0; i < 10; i++) expect(queue.add(['--workspace', `folder${i}`], process.cwd())).toBe(true); expect(queue.add(['--workspace', '.'], process.cwd())).toBe(false); expect(queue.peek()?.target?.root).toBe(path.resolve('folder0'));
});
test('IPC accepts only ticket IDs or workspace-relative external paths', () => {
  expect(() => validate('applyLaunch', { requestId: 'test', launchId: 'ticket' })).not.toThrow(); expect(() => validate('applyLaunch', { requestId: 'test', launchId: 'ticket', root: 'C:/' })).toThrow();
  expect(() => validate('openExternal', { requestId: 'test', workspaceId: 'test', workspaceEpoch: 1, relativePath: '../a.adoc' })).toThrow();
});
test('external launch passes one literal path and workspace blocks links and stale scopes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-launch-'));
  try {
    const target = path.join(root, 'note with & spaces.adoc'), marker = path.join(root, 'opened.json');
    await fs.writeFile(target, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(1)));`);
    const workspace = new Workspace(), session = await workspace.open(root), request = { requestId: 'test', ...session, relativePath: path.basename(target) };
    expect(await workspace.externalPath(request)).toBe(target);
    const editor = new ExternalEditor(path.join(root, 'settings.json')); await expect(editor.open(target)).rejects.toMatchObject({ code: 'NOT_FOUND' }); await editor.configure(process.execPath); await editor.open(target);
    let text = ''; for (let i = 0; i < 100; i++) { try { text = await fs.readFile(marker, 'utf8'); if (text) break; } catch {} await new Promise(resolve => setTimeout(resolve, 20)); }
    expect(JSON.parse(text)).toEqual([target]);
    await fs.mkdir(path.join(root, 'sub')); await fs.symlink(path.join(root, 'sub'), path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(workspace.externalPath({ ...request, relativePath: 'link/a.adoc' })).rejects.toMatchObject({ code: 'OUTSIDE_WORKSPACE' });
    workspace.close(request); await expect(workspace.externalPath(request)).rejects.toMatchObject({ code: 'NO_WORKSPACE' });
  } finally { if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('metis-launch-')) throw Error('Unsafe cleanup'); await fs.rm(root, { recursive: true, force: true }); }
});
