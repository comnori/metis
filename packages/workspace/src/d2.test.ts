import { mkdtemp, writeFile, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { Workspace } from './index';
import { readD2File } from './d2';
import { validate } from '@metis/contracts';

test('D2 dependencies enforce workspace scope, file types, size and symlink boundaries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metis-d2-')), workspace = new Workspace();
  const session = await workspace.open(root);
  const scope = { workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, requestId: 'd2' };
  await writeFile(path.join(root, 'shared.d2'), 'a -> b');
  expect(new TextDecoder().decode(await readD2File(workspace, { ...scope, relativePath: 'shared.d2' }))).toBe('a -> b');
  for (const p of ['../outside.d2', '/root.d2', '.git/config.d2', 'secret.env', 'bad.exe', 'C:/outside.d2']) expect(() => validate('readD2File', { ...scope, relativePath: p })).toThrow();
  await writeFile(path.join(root, 'large.d2'), Buffer.alloc(8 * 1024 * 1024 + 1));
  await expect(readD2File(workspace, { ...scope, relativePath: 'large.d2' })).rejects.toThrow('8 MiB');
  const outside = await mkdtemp(path.join(os.tmpdir(), 'metis-d2-outside-'));
  await writeFile(path.join(outside, 'secret.d2'), 'secret');
  await symlink(outside, path.join(root, 'linked'), 'junction');
  await expect(readD2File(workspace, { ...scope, relativePath: 'linked/secret.d2' })).rejects.toThrow('junction');
  await mkdir(path.join(root, 'folder.d2'));
  await expect(readD2File(workspace, { ...scope, relativePath: 'folder.d2' })).rejects.toThrow();
  workspace.close(scope);
  await expect(readD2File(workspace, { ...scope, relativePath: 'shared.d2' })).rejects.toThrow('폴더');
});

test('D2 export validation excludes PowerPoint and bounds frames and formats', () => {
  const value = { requestId: 'save', workspaceId: 'workspace', workspaceEpoch: 1, format: 'svg', name: 'd2-root', frames: ['<svg/>'] };
  expect(validate('exportD2', value)).toEqual(value);
  for (const patch of [{ format: 'pptx' }, { name: '../outside' }, { frames: ['<html/>'] }, { frames: Array(101).fill('<svg/>'), format: 'gif' }, { interval: 0 }]) expect(() => validate('exportD2', { ...value, ...patch })).toThrow();
});
