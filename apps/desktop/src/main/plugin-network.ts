import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

export function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  // Permit global unicast IPv6 only, excluding mapped IPv4 and local ranges.
  return /^[23][a-f0-9]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
}
export async function remoteResponse(url: string, options: { method?: string; body?: string; headers?: Record<string, string>; signal: AbortSignal }, redirects = 0): Promise<IncomingMessage> {
  options.signal.throwIfAborted();
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) throw Error('공개 HTTPS 주소만 요청할 수 있습니다.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw Error('로컬·사설 네트워크 주소는 요청할 수 없습니다.');
  const selected = addresses[0];
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = https.request(u, { method: options.method ?? 'GET', headers: options.headers, signal: options.signal,
      lookup: ((_host: unknown, opts: { all?: boolean }, callback: Function) => opts.all ? callback(null, [selected]) : callback(null, selected.address, selected.family)) as never }, resolve);
    request.on('error', reject); request.setTimeout(30000, () => request.destroy(Error('네트워크 응답 시간이 초과되었습니다.')));
    request.end(options.body);
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
    response.resume(); if (redirects >= 5) throw Error('리디렉션 횟수를 초과했습니다.');
    const next = new URL(response.headers.location, u);
    // Credential-bearing API requests must never follow a different origin.
    if (options.headers?.Authorization && next.origin !== u.origin) throw Error('인증 요청의 외부 리디렉션을 차단했습니다.');
    return remoteResponse(next.href, options, redirects + 1);
  }
  return response;
}
export async function remoteText(url: string, options: Parameters<typeof remoteResponse>[1], limit = 16 * 1024 * 1024) {
  const response = await remoteResponse(url, options); const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of response) { options.signal.throwIfAborted(); size += chunk.length; if (size > limit) { response.destroy(); throw Error('응답 크기 한도를 초과했습니다.'); } chunks.push(Buffer.from(chunk)); }
  return { status: response.statusCode ?? 500, headers: Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? ''])), body: Buffer.concat(chunks).toString('utf8') };
}
