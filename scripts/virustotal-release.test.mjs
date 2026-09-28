import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyVersionChange, collectReleaseArtifacts, createVirusTotalClient, parseVersionTag, scanArtifacts, verifyRelease } from './virustotal-release.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metis-virustotal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assets = path.join(root, 'assets'), output = path.join(root, 'output');
  await mkdir(assets);
  for (const name of ['Metis-0.2.0-windows-x64.zip', 'Metis-0.2.0-macos-arm64.zip', 'Metis-0.2.0-linux-x64.zip']) await writeFile(path.join(assets, name), name);
  return { root, assets, output };
}

test('stable SemVer accepts an optional v prefix and rejects prereleases', () => {
  assert.deepEqual(parseVersionTag('v0.2.3'), { major: 0, minor: 2, patch: 3, normalized: '0.2.3' });
  assert.throws(() => parseVersionTag('0.2.0-rc.1'), /Invalid stable SemVer/);
  assert.throws(() => parseVersionTag('01.2.3'), /Invalid stable SemVer/);
});

test('version changes classify initial, major, minor and patch releases', () => {
  assert.equal(classifyVersionChange('0.1.0', '').kind, 'initial');
  assert.equal(classifyVersionChange('1.0.0', '0.9.9').kind, 'major');
  assert.equal(classifyVersionChange('0.2.1', '0.1.9').kind, 'minor');
  assert.equal(classifyVersionChange('v0.1.1', '0.1.0').kind, 'patch');
  assert.equal(classifyVersionChange('0.1.1', '0.1.0').scanRequired, false);
});

test('same and decreasing versions fail closed', () => {
  assert.throws(() => classifyVersionChange('0.1.0', '0.1.0'), /must increase/);
  assert.throws(() => classifyVersionChange('0.1.9', '0.2.0'), /must increase/);
  assert.throws(() => classifyVersionChange('1.9.9', '2.0.0'), /must increase/);
});

test('release artifacts are sorted and hashed', async t => {
  const { assets } = await fixture(t), files = await collectReleaseArtifacts(assets);
  assert.equal(files.length, 3);
  assert.deepEqual(files.map(file => file.name), [...files.map(file => file.name)].sort());
  assert.match(files[0].sha256, /^[a-f0-9]{64}$/);
});

test('patch releases skip VirusTotal but retain checksums and evidence', async t => {
  const { assets, output } = await fixture(t);
  const report = await verifyRelease({ assetsDirectory: assets, outputDirectory: output, currentTag: '0.1.1', previousTag: '0.1.0' });
  assert.equal(report.status, 'skipped');
  assert.ok(report.files.every(file => file.status === 'skipped' && !file.virusTotalUrl));
  assert.equal((await readFile(path.join(output, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n').length, 3);
  assert.match(await readFile(path.join(output, 'virustotal-results.json'), 'utf8'), /patch-only version change/);
});

test('minor releases without an API key fail closed and retain error evidence', async t => {
  const { assets, output } = await fixture(t);
  await assert.rejects(verifyRelease({ assetsDirectory: assets, outputDirectory: output, currentTag: '0.2.0', previousTag: '0.1.9' }), /VIRUSTOTAL_API_KEY/);
  const report = JSON.parse(await readFile(path.join(output, 'virustotal-results.json'), 'utf8'));
  assert.equal(report.status, 'error');
  assert.match(report.error, /VIRUSTOTAL_API_KEY/);
});

test('queued analyses complete and pass only with zero malicious and suspicious results', async t => {
  const { assets } = await fixture(t), files = await collectReleaseArtifacts(assets);
  const polls = new Map();
  const client = {
    uploadFile: async file => `analysis-${file.name}`,
    getAnalysis: async id => {
      const count = (polls.get(id) || 0) + 1; polls.set(id, count);
      return { data: { attributes: count === 1 ? { status: 'queued' } : { status: 'completed', stats: { harmless: 60, undetected: 10, malicious: 0, suspicious: 0 } } } };
    }
  };
  await scanArtifacts(files, client, { pollRoundDelayMs: 0 });
  assert.ok(files.every(file => file.passed && file.status === 'completed' && file.virusTotalUrl.endsWith(file.sha256)));
});

test('malicious and suspicious results block a release and still write evidence', async t => {
  for (const category of ['malicious', 'suspicious']) {
    const { assets, output } = await fixture(t);
    const client = {
      uploadFile: async file => `analysis-${file.name}`,
      getAnalysis: async () => ({ data: { attributes: { status: 'completed', stats: { [category]: 1 } } } })
    };
    await assert.rejects(verifyRelease({ assetsDirectory: assets, outputDirectory: output, currentTag: '0.2.0', previousTag: '0.1.9', client, scanOptions: { pollRoundDelayMs: 0 } }), /malicious or suspicious/);
    const report = JSON.parse(await readFile(path.join(output, 'virustotal-results.json'), 'utf8'));
    assert.equal(report.status, 'failed');
  }
});

test('analysis timeout fails closed', async t => {
  const { assets } = await fixture(t), files = await collectReleaseArtifacts(assets);
  const client = { uploadFile: async () => 'analysis', getAnalysis: async () => ({ data: { attributes: { status: 'queued' } } }) };
  await assert.rejects(scanArtifacts(files, client, { timeoutMs: 0, pollRoundDelayMs: 0 }), /timed out/);
});

test('retryable API responses are retried and permanent errors fail', async () => {
  let attempts = 0;
  const retrying = createVirusTotalClient({ apiKey: 'test', requestIntervalMs: 0, retryBaseMs: 0, transport: async () => {
    attempts++;
    return attempts === 1 ? { status: 429, body: '{"error":{"message":"rate limited"}}' } : { status: 200, body: '{"data":{"attributes":{"status":"completed"}}}' };
  } });
  assert.equal((await retrying.getAnalysis('id')).data.attributes.status, 'completed');
  assert.equal(attempts, 2);
  let permanentAttempts = 0;
  const permanent = createVirusTotalClient({ apiKey: 'test', requestIntervalMs: 0, retryBaseMs: 0, transport: async () => { permanentAttempts++; return { status: 400, body: '{"error":{"message":"bad request"}}' }; } });
  await assert.rejects(permanent.getAnalysis('id'), /bad request/);
  assert.equal(permanentAttempts, 1);
});
