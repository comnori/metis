import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const API_ROOT = 'https://www.virustotal.com/api/v3';
const LARGE_FILE_THRESHOLD = 32 * 1024 * 1024;
const DEFAULT_REQUEST_INTERVAL_MS = 20_000;
const DEFAULT_SCAN_TIMEOUT_MS = 60 * 60 * 1000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const sleepDefault = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function parseVersionTag(tag) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag ?? '');
  if (!match) throw new Error(`Invalid stable SemVer tag: ${tag || '<empty>'}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), normalized: `${match[1]}.${match[2]}.${match[3]}` };
}

export function classifyVersionChange(currentTag, previousTag) {
  const current = parseVersionTag(currentTag);
  if (!previousTag) return { kind: 'initial', current, previous: null, scanRequired: true };
  const previous = parseVersionTag(previousTag);
  const parts = ['major', 'minor', 'patch'];
  for (const part of parts) {
    if (current[part] < previous[part]) throw new Error(`Version must increase: ${previous.normalized} -> ${current.normalized}`);
    if (current[part] > previous[part]) return { kind: part, current, previous, scanRequired: part !== 'patch' };
  }
  throw new Error(`Version must increase: ${previous.normalized} -> ${current.normalized}`);
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function collectReleaseArtifacts(assetsDirectory) {
  const names = (await readdir(assetsDirectory)).filter(name => name.endsWith('.zip')).sort();
  if (names.length !== 3) throw new Error(`Expected exactly three release ZIP files, found ${names.length}.`);
  return Promise.all(names.map(async name => {
    const filePath = path.join(assetsDirectory, name);
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error(`Release artifact is not a file: ${name}`);
    return { name, path: filePath, size: info.size, sha256: await sha256File(filePath), status: 'pending' };
  }));
}

function spawnCollect(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('exit', code => {
      const output = Buffer.concat(stdout).toString('utf8'), errorOutput = Buffer.concat(stderr).toString('utf8').trim();
      if (code === 0) resolve(output);
      else reject(new Error(`curl exited with ${code}${errorOutput ? `: ${errorOutput}` : ''}`));
    });
  });
}

export async function curlTransport({ method, url, apiKey, filePath }) {
  const args = ['--silent', '--show-error', '--location', '--connect-timeout', '30', '--max-time', '900', '--request', method, '--header', 'accept: application/json', '--header', `x-apikey: ${apiKey}`];
  if (filePath) args.push('--form', `file=@${filePath}`);
  args.push('--write-out', '\n%{http_code}', url);
  const output = await spawnCollect(process.env.CURL_COMMAND || 'curl', args);
  const separator = output.lastIndexOf('\n');
  if (separator < 0) throw new Error('VirusTotal response did not include an HTTP status.');
  return { status: Number(output.slice(separator + 1)), body: output.slice(0, separator) };
}

function parseResponse(response, label) {
  let body;
  try { body = JSON.parse(response.body); }
  catch { throw new Error(`${label} returned invalid JSON (HTTP ${response.status}).`); }
  if (response.status < 200 || response.status >= 300) {
    const detail = body?.error?.message || body?.error?.code || `HTTP ${response.status}`;
    throw new Error(`${label} failed: ${detail}`);
  }
  return body;
}

export function createVirusTotalClient({
  apiKey,
  transport = curlTransport,
  sleep = sleepDefault,
  now = Date.now,
  requestIntervalMs = DEFAULT_REQUEST_INTERVAL_MS,
  retryBaseMs = 30_000,
  maxRetries = 3
} = {}) {
  if (!apiKey) throw new Error('VIRUSTOTAL_API_KEY is required for a Minor or Major release.');
  let lastRequestAt = Number.NEGATIVE_INFINITY;

  async function request(method, url, filePath, label) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const wait = Math.max(0, requestIntervalMs - (now() - lastRequestAt));
      if (wait) await sleep(wait);
      lastRequestAt = now();
      let response;
      try {
        response = await transport({ method, url, apiKey, filePath });
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries) throw error;
        await sleep(retryBaseMs * (2 ** attempt));
        continue;
      }
      if (response.status >= 200 && response.status < 300) return parseResponse(response, label);
      if (!RETRYABLE_STATUS.has(response.status) || attempt === maxRetries) return parseResponse(response, label);
      lastError = new Error(`${label} received retryable HTTP ${response.status}.`);
      await sleep(retryBaseMs * (2 ** attempt));
    }
    throw lastError || new Error(`${label} failed.`);
  }

  return {
    async uploadFile(file) {
      let uploadUrl = `${API_ROOT}/files`;
      if (file.size > LARGE_FILE_THRESHOLD) {
        const response = await request('GET', `${API_ROOT}/files/upload_url`, null, 'VirusTotal upload URL request');
        if (typeof response?.data !== 'string') throw new Error('VirusTotal did not return a large-file upload URL.');
        uploadUrl = response.data;
      }
      const response = await request('POST', uploadUrl, file.path, `VirusTotal upload for ${file.name}`);
      if (typeof response?.data?.id !== 'string') throw new Error(`VirusTotal did not return an analysis ID for ${file.name}.`);
      return response.data.id;
    },
    async getAnalysis(analysisId) {
      return request('GET', `${API_ROOT}/analyses/${encodeURIComponent(analysisId)}`, null, 'VirusTotal analysis request');
    }
  };
}

function normalizedStats(stats = {}) {
  return {
    harmless: Number(stats.harmless || 0),
    malicious: Number(stats.malicious || 0),
    suspicious: Number(stats.suspicious || 0),
    undetected: Number(stats.undetected || 0),
    timeout: Number(stats.timeout || 0),
    'confirmed-timeout': Number(stats['confirmed-timeout'] || 0),
    failure: Number(stats.failure || 0),
    'type-unsupported': Number(stats['type-unsupported'] || 0)
  };
}

export async function scanArtifacts(artifacts, client, {
  sleep = sleepDefault,
  now = Date.now,
  timeoutMs = DEFAULT_SCAN_TIMEOUT_MS,
  pollRoundDelayMs = 1_000
} = {}) {
  const startedAt = now();
  for (const artifact of artifacts) {
    artifact.analysisId = await client.uploadFile(artifact);
    artifact.status = 'queued';
  }
  const pending = new Set(artifacts);
  while (pending.size) {
    for (const artifact of [...pending]) {
      if (now() - startedAt >= timeoutMs) throw new Error(`VirusTotal analysis timed out after ${timeoutMs}ms.`);
      const response = await client.getAnalysis(artifact.analysisId);
      const attributes = response?.data?.attributes;
      if (!attributes || typeof attributes.status !== 'string') throw new Error(`VirusTotal returned an invalid analysis for ${artifact.name}.`);
      if (!['queued', 'in-progress', 'completed'].includes(attributes.status)) throw new Error(`VirusTotal returned an unsupported analysis status for ${artifact.name}: ${attributes.status}`);
      artifact.status = attributes.status;
      if (attributes.status === 'completed') {
        artifact.stats = normalizedStats(attributes.stats);
        artifact.analysisDate = Number.isFinite(attributes.date) ? new Date(attributes.date * 1000).toISOString() : new Date(now()).toISOString();
        artifact.virusTotalUrl = `https://www.virustotal.com/gui/file/${artifact.sha256}`;
        artifact.passed = artifact.stats.malicious === 0 && artifact.stats.suspicious === 0;
        pending.delete(artifact);
      }
    }
    if (pending.size && pollRoundDelayMs) await sleep(pollRoundDelayMs);
  }
  return artifacts;
}

function markdownEscape(value) { return String(value).replaceAll('|', '\\|'); }

export function renderReleaseNotes(report) {
  const lines = ['## Security verification', '', `Version change: **${report.versionChange}**`, '', '| File | SHA-256 | VirusTotal |', '|---|---|---|'];
  for (const file of report.files) {
    let result = 'Not scanned (patch-only release policy)';
    if (file.virusTotalUrl) result = `[${file.stats.malicious} malicious / ${file.stats.suspicious} suspicious](${file.virusTotalUrl})`;
    else if (report.status === 'error') result = 'Verification error';
    lines.push(`| ${markdownEscape(file.name)} | \`${file.sha256}\` | ${result} |`);
  }
  lines.push('', report.status === 'passed' ? '**VirusTotal policy: passed.**' : report.status === 'skipped' ? '**VirusTotal scan skipped for a patch-only release.**' : `**VirusTotal policy: ${report.status}.**`, '');
  return lines.join('\n');
}

async function writeEvidence(report, outputDirectory, summaryPath) {
  report.generatedAt = new Date().toISOString();
  await mkdir(outputDirectory, { recursive: true });
  const checksum = report.files.map(file => `${file.sha256}  ${file.name}`).join('\n') + '\n';
  const notes = renderReleaseNotes(report);
  await Promise.all([
    writeFile(path.join(outputDirectory, 'SHA256SUMS.txt'), checksum),
    writeFile(path.join(outputDirectory, 'virustotal-results.json'), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(path.join(outputDirectory, 'release-notes.md'), notes)
  ]);
  if (summaryPath) await appendFile(summaryPath, `${notes}\n`);
}

export async function verifyRelease({
  assetsDirectory,
  outputDirectory,
  currentTag,
  previousTag,
  apiKey,
  client,
  scanOptions,
  summaryPath
}) {
  const change = classifyVersionChange(currentTag, previousTag);
  const report = {
    schemaVersion: 1,
    releaseTag: currentTag,
    previousReleaseTag: previousTag || null,
    versionChange: change.kind,
    policy: { malicious: 0, suspicious: 0 },
    status: change.scanRequired ? 'pending' : 'skipped',
    reason: change.scanRequired ? undefined : 'patch-only version change',
    files: await collectReleaseArtifacts(assetsDirectory)
  };
  let failure;
  try {
    if (change.scanRequired) {
      const virusTotalClient = client || createVirusTotalClient({ apiKey });
      await scanArtifacts(report.files, virusTotalClient, scanOptions);
      report.status = report.files.every(file => file.passed) ? 'passed' : 'failed';
      if (report.status === 'failed') failure = new Error('VirusTotal detected a malicious or suspicious release artifact.');
    } else {
      for (const file of report.files) file.status = 'skipped';
    }
  } catch (error) {
    report.status = 'error';
    report.error = error instanceof Error ? error.message : String(error);
    failure = error;
  }
  await writeEvidence(report, outputDirectory, summaryPath);
  if (failure) throw failure;
  return report;
}

function option(args, name, required = true) {
  const index = args.indexOf(name), value = index >= 0 ? args[index + 1] : undefined;
  if (required && !value) throw new Error(`Missing required option: ${name}`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  await verifyRelease({
    assetsDirectory: path.resolve(option(args, '--assets')),
    outputDirectory: path.resolve(option(args, '--output')),
    currentTag: option(args, '--current-tag'),
    previousTag: option(args, '--previous-tag', false) || '',
    apiKey: process.env.VIRUSTOTAL_API_KEY,
    summaryPath: process.env.GITHUB_STEP_SUMMARY,
    scanOptions: {
      timeoutMs: Number(process.env.VT_SCAN_TIMEOUT_MS || DEFAULT_SCAN_TIMEOUT_MS),
      pollRoundDelayMs: Number(process.env.VT_POLL_DELAY_MS || 1_000)
    }
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
