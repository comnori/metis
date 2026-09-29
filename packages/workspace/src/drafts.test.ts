import { afterEach, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Drafts } from './drafts';
import { validate } from '@metis/contracts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

test('drafts survive a store restart and can be removed after an explicit save', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-drafts-')); roots.push(root);
  const request = { requestId: 'draft', workspaceId: 'workspace', workspaceEpoch: 1, relativePath: 'notes/a.adoc', revision: 'a'.repeat(64), text: '= Unsaved\n' };
  await new Drafts(root).write('b'.repeat(64), request);
  expect(await new Drafts(root).read('b'.repeat(64), request)).toMatchObject({ relativePath: request.relativePath, revision: request.revision, text: request.text });
  await new Drafts(root).delete('b'.repeat(64), request);
  expect(await new Drafts(root).read('b'.repeat(64), request)).toBeNull();
});

test('drafts are isolated by workspace and document', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-drafts-')); roots.push(root);
  const drafts = new Drafts(root), request = { requestId: 'draft', workspaceId: 'workspace', workspaceEpoch: 1, relativePath: 'a.adoc', revision: 'c'.repeat(64), text: 'local' };
  await drafts.write('d'.repeat(64), request);
  expect(await drafts.read('e'.repeat(64), request)).toBeNull();
  expect(await drafts.read('d'.repeat(64), { ...request, relativePath: 'b.adoc' })).toBeNull();
});

test('draft IPC accepts only bounded document paths, revisions and text', () => {
  const request = { requestId: 'draft', workspaceId: 'workspace', workspaceEpoch: 1, relativePath: 'a.adoc', revision: 'a'.repeat(64), text: 'local' };
  expect(validate('writeDraft', request)).toEqual(request);
  expect(() => validate('writeDraft', { ...request, relativePath: '../a.adoc' })).toThrow();
  expect(() => validate('writeDraft', { ...request, revision: 'stale' })).toThrow();
  expect(() => validate('readDraft', { requestId: 'draft', workspaceId: 'workspace', workspaceEpoch: 1, relativePath: '' })).toThrow();
});
