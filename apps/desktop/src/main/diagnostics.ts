import type { App, Event as ElectronEvent, WebContents } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { release } from 'node:os';
import path from 'node:path';

const maxLogBytes = 2 * 1024 * 1024;
const backupCount = 3;
const maxTextLength = 8192;

// Export renderers load whole documents as data URLs. Never copy those into logs.
function diagnosticUrl(value: string): string {
  if (!value) return '';
  if (/^(data|blob|javascript):/i.test(value)) return `${value.slice(0, value.indexOf(':'))}:[redacted]`;
  try {
    const url = new URL(value);
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.href;
  } catch { return '[invalid URL]'; }
}

function diagnosticText(value: string): string {
  const bounded = value.slice(0, maxTextLength);
  const redacted = bounded
    .replace(/\b(?:data|blob|javascript):[^\r\n]*/gi, diagnosticUrl)
    .replace(/\b(?:https?|file):[^\s"'<>]+/gi, diagnosticUrl);
  return redacted + (value.length > maxTextLength ? ' [truncated]' : '');
}

export function createDiagnosticLog(directory: string, limit = maxLogBytes) {
  const filePath = path.join(directory, 'diagnostics.jsonl');
  const sessionId = randomUUID();
  let warned = false;
  return {
    filePath,
    write(event: string, details: Record<string, unknown> = {}): void {
      try {
        const line = JSON.stringify({ timestamp: new Date().toISOString(), sessionId, mainPid: process.pid, event, details }, (_key, value: unknown) => {
          if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack, code: (value as NodeJS.ErrnoException).code };
          return typeof value === 'string' ? diagnosticText(value) : value;
        }) + '\n';
        mkdirSync(directory, { recursive: true });
        if (existsSync(filePath) && statSync(filePath).size + Buffer.byteLength(line) > limit) {
          rmSync(`${filePath}.${backupCount}`, { force: true });
          for (let index = backupCount - 1; index >= 1; index--) {
            if (existsSync(`${filePath}.${index}`)) renameSync(`${filePath}.${index}`, `${filePath}.${index + 1}`);
          }
          renameSync(filePath, `${filePath}.1`);
        }
        // No async queue: shutdown/crash handlers must finish writing before returning.
        appendFileSync(filePath, line, { encoding: 'utf8', flush: true });
      } catch (error) {
        // A denied/locked/full log directory must not prevent the app from starting.
        if (!warned) {
          warned = true;
          console.error('Metis diagnostic log unavailable:', filePath, (error as NodeJS.ErrnoException).code ?? 'unknown error');
        }
      }
    }
  };
}

type DiagnosticLog = ReturnType<typeof createDiagnosticLog>;

function watchWebContents(contents: WebContents, log: DiagnosticLog): void {
  const webContentsId = contents.id, webContentsType = contents.getType();
  let rendererPid: number | null = null, url = '';
  const context = () => {
    try {
      if (!contents.isDestroyed()) {
        rendererPid = contents.getOSProcessId() || rendererPid;
        url = diagnosticUrl(contents.getURL());
      }
    } catch { /* Keep the last observed PID/URL if the renderer has already gone. */ }
    return { webContentsId, webContentsType, rendererPid, url };
  };
  log.write('web-contents-created', context());
  contents.on('did-start-loading', () => { context(); });
  contents.on('dom-ready', () => log.write('dom-ready', context()));
  contents.on('did-finish-load', () => log.write('did-finish-load', context()));
  contents.on('render-process-gone', (_event, details) => {
    log.write('render-process-gone', { ...context(), ...details });
    rendererPid = null;
  });
  contents.on('preload-error', (_event, preloadPath, error) => {
    log.write('preload-error', { ...context(), preloadPath, error });
  });
  const loadFailure = (event: string) => (_event: ElectronEvent, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean, frameProcessId: number, frameRoutingId: number) => {
    log.write(event, { ...context(), errorCode, errorDescription, validatedURL: diagnosticUrl(validatedURL), isMainFrame, frameProcessId, frameRoutingId });
  };
  contents.on('did-fail-load', loadFailure('did-fail-load'));
  contents.on('did-fail-provisional-load', loadFailure('did-fail-provisional-load'));
  contents.on('unresponsive', () => log.write('unresponsive', context()));
  contents.on('responsive', () => log.write('responsive', context()));
  contents.once('destroyed', () => log.write('web-contents-destroyed', { webContentsId, webContentsType, rendererPid, url }));
}

/** Install before app readiness, and only in the instance that owns the profile. */
export function installDiagnostics(app: App): DiagnosticLog {
  const log = createDiagnosticLog(path.join(app.getPath('userData'), 'logs'));
  app.on('web-contents-created', (_event, contents) => watchWebContents(contents, log));
  app.on('child-process-gone', (_event, details) => log.write('child-process-gone', { ...details }));
  app.on('before-quit', () => log.write('before-quit'));
  app.on('quit', (_event, exitCode) => log.write('app-quit', { exitCode }));
  // Monitoring preserves Node's existing fatal-exception behavior.
  process.on('uncaughtExceptionMonitor', (error, origin) => log.write('uncaught-exception', { origin, error }));
  process.on('exit', exitCode => log.write('main-process-exit', { exitCode }));
  log.write('app-start', {
    appVersion: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome,
    node: process.versions.node, platform: process.platform, osRelease: release(), arch: process.arch,
    packaged: app.isPackaged, executable: process.execPath,
    noSandbox: app.commandLine.hasSwitch('no-sandbox'), disableGpu: app.commandLine.hasSwitch('disable-gpu')
  });
  return log;
}
