import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BoundaryError } from '@metis/contracts';
export class ExternalEditor {
  constructor(private settings: string) {}
  async configure(executable: string) {
    const resolved = await fs.realpath(executable);
    if (!(await fs.stat(resolved)).isFile() || (process.platform === 'win32' && !/\.exe$/i.test(resolved))) throw new BoundaryError('UNSUPPORTED_FILE', '편집기 실행 파일을 선택하세요. Windows에서는 .exe만 지원합니다.');
    await fs.mkdir(path.dirname(this.settings), { recursive: true }); await fs.writeFile(this.settings, JSON.stringify({ executable: resolved }), { flush: true }); return path.basename(resolved);
  }
  async open(file: string) {
    let executable: string;
    try { const data = JSON.parse(await fs.readFile(this.settings, 'utf8')); executable = data.executable; if (typeof executable !== 'string' || !path.isAbsolute(executable) || !(await fs.stat(executable)).isFile()) throw Error(); }
    catch { throw new BoundaryError('NOT_FOUND', '먼저 외부 편집기 설정에서 실행 파일을 선택하세요.'); }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, [file], { shell: false, windowsHide: false, detached: true, stdio: 'ignore' });
      child.once('error', () => reject(new BoundaryError('INTERNAL_ERROR', '외부 편집기를 실행하지 못했습니다. 설정한 실행 파일을 확인하세요.')));
      child.once('spawn', () => { child.unref(); resolve(); });
    });
    return null;
  }
}
