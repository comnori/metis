import { afterEach, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { App } from 'electron';
import { createDiagnosticLog, installDiagnostics } from './diagnostics';

const roots: string[] = [];
const disposers: (() => void)[] = [];
const fixtureRoot = path.resolve(import.meta.dirname, '../../../../.pre04-runs');
function fixture() {
  mkdirSync(fixtureRoot, { recursive: true });
  const root = mkdtempSync(path.join(fixtureRoot, 'diagnostics-unit-'));
  roots.push(root); return root;
}
function records(file: string) {
  return readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
}
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== fixtureRoot || !path.basename(root).startsWith('diagnostics-unit-')) throw Error('Unsafe cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});

test('writes complete JSONL immediately, preserves error details, and separates launches', () => {
  const directory = fixture(), first = createDiagnosticLog(directory);
  const error = Object.assign(new Error('preload failed\nsecond line'), { code: 'EACCES' });
  first.write('preload-error', { preloadPath: 'C:\\Metis\\preload.cjs', error });
  first.write('render-process-gone', { reason: 'integrity-failure', exitCode: -1073740791 });
  createDiagnosticLog(directory).write('app-start');
  const lines = records(first.filePath);
  expect(lines).toHaveLength(3);
  expect(lines[0]).toMatchObject({ mainPid: process.pid, event: 'preload-error', details: { error: { name: 'Error', message: error.message, code: 'EACCES' } } });
  expect(lines[0].details.error.stack).toContain('preload failed');
  expect(Number.isNaN(Date.parse(lines[0].timestamp))).toBe(false);
  expect(lines[0].sessionId).toBe(lines[1].sessionId);
  expect(lines[2].sessionId).not.toBe(lines[0].sessionId);
  expect(lines[1].details.exitCode).toBe(-1073740791);
});

test('redacts inline documents and URL credentials, queries and fragments even in error stacks', () => {
  const log = createDiagnosticLog(fixture());
  log.write('did-fail-load', {
    url: 'https://user:password@example.test/page?token=secret#fragment',
    error: new Error('Failed data:text/html,%3Ch1%3Eprivate-document%3C/h1%3E at https://user:password@example.test/page?token=secret#fragment'),
    rawDataError: 'Failed data:text/html,<h1>private-document with spaces</h1>',
    long: 'x'.repeat(10000)
  });
  const text = readFileSync(log.filePath, 'utf8');
  expect(text).not.toMatch(/password|secret|fragment|private-document/);
  const entry = records(log.filePath)[0];
  expect(entry.details.url).toBe('https://example.test/page');
  expect(entry.details.error.message).toContain('data:[redacted]');
  expect(entry.details.long.length).toBeLessThan(8300);
});

test('rotates bounded backups without truncating records or losing the latest event', () => {
  const directory = fixture(), log = createDiagnosticLog(directory, 400);
  for (let index = 0; index < 8; index++) log.write('event', { index, padding: 'x'.repeat(150) });
  expect(readdirSync(directory).sort()).toEqual(['diagnostics.jsonl', 'diagnostics.jsonl.1', 'diagnostics.jsonl.2', 'diagnostics.jsonl.3']);
  expect(records(log.filePath).map(entry => entry.details.index)).toEqual([7]);
  for (let index = 1; index <= 3; index++) expect(records(`${log.filePath}.${index}`)[0].details.index).toBe(7 - index);
});

test('a log I/O failure does not throw and logging recovers on a later event', () => {
  const directory = path.join(fixture(), 'logs');
  writeFileSync(directory, 'blocked');
  const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
  const log = createDiagnosticLog(directory);
  expect(() => { log.write('first'); log.write('second'); }).not.toThrow();
  expect(warning).toHaveBeenCalledTimes(1);
  rmSync(directory);
  log.write('recovered');
  expect(records(log.filePath)[0].event).toBe('recovered');
});

test('captures early and auxiliary renderer failures, GPU launch failure and clean app exit', () => {
  const profile = fixture();
  const app = Object.assign(new EventEmitter(), {
    getPath: () => profile, getVersion: () => '0.3.0', isPackaged: false,
    commandLine: { hasSwitch: () => false }
  });
  const oldMonitor = process.listeners('uncaughtExceptionMonitor'), oldExit = process.listeners('exit');
  const log = installDiagnostics(app as unknown as App);
  disposers.push(() => {
    for (const listener of process.listeners('uncaughtExceptionMonitor')) if (!oldMonitor.includes(listener)) process.off('uncaughtExceptionMonitor', listener);
    for (const listener of process.listeners('exit')) if (!oldExit.includes(listener)) process.off('exit', listener);
  });
  let pid = 4242, destroyed = false;
  const contents = Object.assign(new EventEmitter(), {
    id: 7, getType: () => 'window', isDestroyed: () => destroyed,
    getOSProcessId: () => pid, getURL: () => 'data:text/html,private-export'
  });
  app.emit('web-contents-created', {}, contents);
  contents.emit('preload-error', {}, 'preload.cjs', new Error('sandbox preload failed'));
  contents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///missing.html?token=secret', true, 10, 20);
  contents.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', 'https://example.test/frame', false, 11, 21);
  pid = 0; destroyed = true;
  contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 9 });
  contents.emit('destroyed');
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'launch-failed', exitCode: 5, systemErrorCode: 5 });
  app.emit('quit', {}, 0);
  const lines = records(log.filePath);
  expect(lines.find(line => line.event === 'preload-error')).toMatchObject({ details: { webContentsId: 7, rendererPid: 4242, error: { message: 'sandbox preload failed' } } });
  expect(lines.find(line => line.event === 'did-fail-load')).toMatchObject({ details: { errorCode: -6, validatedURL: 'file:///missing.html', isMainFrame: true, frameProcessId: 10, frameRoutingId: 20 } });
  expect(lines.find(line => line.event === 'did-fail-provisional-load')).toMatchObject({ details: { errorCode: -3, isMainFrame: false } });
  expect(lines.find(line => line.event === 'render-process-gone')).toMatchObject({ details: { rendererPid: 4242, reason: 'crashed', exitCode: 9 } });
  expect(lines.find(line => line.event === 'child-process-gone')).toMatchObject({ details: { type: 'GPU', reason: 'launch-failed', systemErrorCode: 5 } });
  expect(lines.at(-1)).toMatchObject({ event: 'app-quit', details: { exitCode: 0 } });
  expect(readFileSync(log.filePath, 'utf8')).not.toMatch(/private-export|secret/);
});
