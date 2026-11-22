import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLaunch } from '@metis/workspace';
import { launchArguments } from './launch-arguments';

describe('Electron launch arguments', () => {
  const appPath = path.resolve('apps/desktop');
  it('removes the Linux automation runtime prefix from a packaged launch', () => {
    const args = launchArguments(['Metis', '--no-sandbox', '--inspect=0', '--remote-debugging-port=0', '--smoke'], false, appPath);
    expect(args).toEqual(['--smoke']);
    expect(parseLaunch(args, process.cwd())).toBeUndefined();
  });
  it('preserves document targets and deep links after runtime switches', () => {
    const target = ['--workspace', 'my notes', '--file', 'sub/a.adoc', '--line', '12'];
    expect(launchArguments(['Metis', '--inspect-brk=9229', ...target], false, appPath)).toEqual(target);
    expect(launchArguments(['Metis', 'metis://auth/provider/callback?code=test'], false, appPath)).toEqual(['metis://auth/provider/callback?code=test']);
  });
  it('locates the development app before reading its arguments', () => {
    const target = ['--smoke', '--workspace', 'notes'];
    expect(launchArguments(['electron', '--no-sandbox', '--inspect=0', appPath, ...target], true, appPath)).toEqual(target);
  });
  it('keeps unknown options and application argument values for strict validation', () => {
    for (const options of [['--eval', 'code'], ['--no-sandbox-extra'], ['--workspace', 'notes', '--unexpected']]) {
      expect(() => parseLaunch(launchArguments(['Metis', ...options], false, appPath), process.cwd())).toThrow();
    }
    expect(launchArguments(['Metis', '--workspace', 'notes', '--inspect=0'], false, appPath)).toEqual(['--workspace', 'notes', '--inspect=0']);
  });
});
