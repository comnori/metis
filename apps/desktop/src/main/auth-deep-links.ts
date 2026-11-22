import { randomBytes } from 'node:crypto';

export const authProtocol = 'metis';
const providerPattern = /^[a-z][a-z0-9-]{0,50}$/;

export function authCallbackUri(provider: string) {
  if (!providerPattern.test(provider)) throw Error('인증 연결 ID가 올바르지 않습니다.');
  return `${authProtocol}://auth/${provider}/callback`;
}

export function callbackProvider(uri: string): string | undefined {
  const match = /^metis:\/\/auth\/([a-z][a-z0-9-]{0,50})\/callback$/.exec(uri);
  return match?.[1];
}

/** Keep protocol launches out of the file/CLI queue, including malformed URLs. */
export function splitDeepLinkArguments(args: string[]) {
  return { links: args.filter(value => /^metis:/i.test(value)), args: args.filter(value => !/^metis:/i.test(value)) };
}

interface Pending {
  owner: string;
  redirectUri: string;
  finish(error?: Error, code?: string): void;
}

/** Main-only, in-memory handoff. A restart requires a new authorization attempt. */
export class AuthDeepLinks {
  private pending = new Map<string, Pending>();

  begin(owner: string, provider: string, signal: AbortSignal, timeout = 180000) {
    signal.throwIfAborted();
    if ([...this.pending.values()].some(value => value.owner === owner)) throw Error('이미 진행 중인 인증 요청이 있습니다.');
    const redirectUri = authCallbackUri(provider), state = randomBytes(32).toString('hex');
    let cancel!: () => void;
    const code = new Promise<string>((resolve, reject) => {
      const finish = (error?: Error, value?: string) => {
        if (!this.pending.delete(state)) return;
        clearTimeout(timer); signal.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve(value!);
      };
      cancel = () => finish(Error('인증 요청을 취소했습니다.'));
      const timer = setTimeout(() => finish(Error('인증 응답 시간이 초과되었습니다. 다시 연결하세요.')), timeout);
      this.pending.set(state, { owner, redirectUri, finish });
      signal.addEventListener('abort', cancel, { once: true });
    });
    // The browser may fail before the caller starts awaiting this promise.
    void code.catch(() => {});
    return { state, redirectUri, code, cancel };
  }

  cancelOwner(owner: string) {
    for (const pending of this.pending.values()) if (pending.owner === owner) pending.finish(Error('인증 요청을 취소했습니다.'));
  }

  receive(raw: string): boolean {
    if (raw.length > 4096 || /[\s\\\x00-\x1f]/.test(raw)) return false;
    try {
      const uri = new URL(raw), base = raw.split('?')[0];
      if (!callbackProvider(base) || uri.hash || uri.username || uri.password || uri.port) return false;
      const params = uri.searchParams;
      if ([...params.keys()].some(key => !['state', 'code', 'error'].includes(key) || params.getAll(key).length !== 1)) return false;
      const state = params.get('state') ?? '', code = params.get('code'), error = params.get('error');
      if (!/^[a-f0-9]{64}$/.test(state) || (!!code === !!error)) return false;
      if (code !== null && !/^[A-Za-z0-9._~-]{1,2048}$/.test(code)) return false;
      if (error !== null && !/^[a-z_]{1,100}$/.test(error)) return false;
      const pending = this.pending.get(state);
      if (!pending || pending.redirectUri !== base) return false;
      pending.finish(error ? Error('Notion 승인이 취소되었거나 인증에 실패했습니다. 다시 연결하세요.') : undefined, code ?? undefined);
      return true;
    } catch { return false; }
  }
}
