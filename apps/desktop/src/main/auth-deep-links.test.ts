import { expect, test, vi } from 'vitest';
import { AuthDeepLinks, authCallbackUri, splitDeepLinkArguments } from './auth-deep-links';

const provider = 'notion-to-metis';
const reply = (attempt: { redirectUri: string; state: string }, query = 'code=handoff-code') => `${attempt.redirectUri}?state=${attempt.state}&${query}`;

test('callbacks match an active owner, exact route and one-time state', async () => {
  const links = new AuthDeepLinks(), signal = new AbortController().signal;
  const a = links.begin('workspace-a/plugin', provider, signal), b = links.begin('workspace-b/plugin', provider, signal);
  expect(a.redirectUri).toBe('metis://auth/notion-to-metis/callback');
  expect(a.state).not.toBe(b.state);
  expect(links.receive(reply(a).replace(a.state, '0'.repeat(64)))).toBe(false);
  expect(links.receive(reply(a).replace(provider, 'other-plugin'))).toBe(false);
  expect(links.receive(reply(a))).toBe(true); expect(await a.code).toBe('handoff-code');
  expect(links.receive(reply(a))).toBe(false);
  expect(links.receive(reply(b))).toBe(true); await b.code;
});

test('malformed, token-bearing and ambiguous callbacks are never accepted', async () => {
  const links = new AuthDeepLinks(), attempt = links.begin('a', provider, new AbortController().signal);
  for (const url of [
    reply(attempt) + '&access_token=secret', reply(attempt) + '&refresh_token=secret',
    reply(attempt) + '&state=' + attempt.state, reply(attempt) + '&code=duplicate',
    reply(attempt) + '&error=access_denied', reply(attempt) + '#fragment',
    reply(attempt).replace('auth/', 'user@auth/'), reply(attempt).replace('auth/', 'auth:123/'),
    reply(attempt).replace('/callback', '/other/../callback'), reply(attempt, 'code=%0Asecret'),
    reply(attempt).replace('metis:', 'https:'), reply(attempt) + 'x'.repeat(4096)
  ]) expect(links.receive(url)).toBe(false);
  expect(links.receive(reply(attempt))).toBe(true); await attempt.code;
});

test('cancel, expiry, rejection and process restart invalidate callbacks', async () => {
  vi.useFakeTimers();
  try {
    const links = new AuthDeepLinks(), controller = new AbortController();
    const cancelled = links.begin('cancel', provider, controller.signal); controller.abort();
    await expect(cancelled.code).rejects.toThrow('취소'); expect(links.receive(reply(cancelled))).toBe(false);
    const expired = links.begin('expired', provider, new AbortController().signal, 20);
    const expiry = expect(expired.code).rejects.toThrow('초과'); await vi.advanceTimersByTimeAsync(21); await expiry;
    expect(links.receive(reply(expired))).toBe(false);
    const denied = links.begin('deny', provider, new AbortController().signal);
    expect(links.receive(reply(denied, 'error=access_denied'))).toBe(true); await expect(denied.code).rejects.toThrow('승인');
    const reset = links.begin('workspace', provider, new AbortController().signal);
    expect(() => links.begin('workspace', provider, new AbortController().signal)).toThrow('진행');
    expect(new AuthDeepLinks().receive(reply(reset))).toBe(false);
    links.cancelOwner('workspace'); await expect(reset.code).rejects.toThrow('취소'); expect(links.receive(reply(reset))).toBe(false);
  } finally { vi.useRealTimers(); }
});

test('protocol arguments cannot reach the document launch queue', () => {
  expect(splitDeepLinkArguments(['--open', 'document.adoc', 'metis://auth/x/callback?code=private', 'METIS:malformed'])).toEqual({ args: ['--open', 'document.adoc'], links: ['metis://auth/x/callback?code=private', 'METIS:malformed'] });
  expect(() => authCallbackUri('../outside')).toThrow();
});
