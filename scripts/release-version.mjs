import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function nextVersion(version, bump) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error(`Invalid stable version: ${version}`);
  const parts = version.split('.').map(Number);
  const index = ['major', 'minor', 'patch'].indexOf(bump);
  if (index < 0) throw new Error(`Invalid bump: ${bump}`);
  parts[index]++;
  for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
  if (!parts.every(Number.isSafeInteger)) throw new Error('Version exceeds safe integer range.');
  return parts.join('.');
}

export function git(root, ...args) {
  return execFileSync(process.env.RELEASE_GIT ?? 'git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export async function versionFiles(root, version) {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const files = ['package.json'];
  for (const pattern of manifest.workspaces) {
    if (!/^[\w-]+\/\*$/.test(pattern)) throw new Error(`Unsupported workspace pattern: ${pattern}`);
    const directory = pattern.slice(0, -2);
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      if (entry.isDirectory()) files.push(`${directory}/${entry.name}/package.json`);
    }
  }
  const updates = new Map();
  for (const file of files) {
    const source = await readFile(path.join(root, file), 'utf8');
    if (JSON.parse(source).version !== manifest.version) throw new Error(`Version mismatch: ${file}`);
    updates.set(file, source.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${version}"`));
  }
  const lockSource = await readFile(path.join(root, 'package-lock.json'), 'utf8');
  const lock = JSON.parse(lockSource);
  if (lock.version !== manifest.version) throw new Error('Root lockfile version mismatch.');
  lock.version = version;
  for (const file of files) {
    const key = file === 'package.json' ? '' : file.slice(0, -'/package.json'.length);
    if (lock.packages[key]?.version !== manifest.version) throw new Error(`Lockfile version mismatch: ${key || 'root'}`);
    lock.packages[key].version = version;
  }
  const eol = lockSource.includes('\r\n') ? '\r\n' : '\n';
  updates.set('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`.replaceAll('\n', eol));
  return updates;
}

export async function prepare(root, directory, bump, runId, previousTag = '') {
  if (!/^\d+$/.test(runId)) throw new Error('A numeric GitHub run ID is required.');
  git(root, 'diff', '--exit-code', 'HEAD');
  const baseSha = git(root, 'rev-parse', 'HEAD');
  const current = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  const version = nextVersion(current, bump);
  const tag = `v${version}`;
  if (git(root, 'tag', '--list', tag, version)) throw new Error(`Release tag already exists: ${tag}`);
  const updates = await versionFiles(root, version);
  for (const [file, contents] of updates) await writeFile(path.join(root, file), contents);
  git(root, 'add', '--', ...updates.keys());
  git(root, '-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    '-c', 'commit.gpgsign=false', 'commit', '-m', `chore: release ${tag} (run ${runId})`);
  const candidateSha = git(root, 'rev-parse', 'HEAD');
  const manifest = { baseSha, candidateSha, version, tag, runId, previousTag };
  await mkdir(directory, { recursive: true });
  git(root, 'bundle', 'create', path.resolve(directory, 'candidate.bundle'), 'HEAD', `^${baseSha}`);
  await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function applyCandidate(root, directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (![manifest.baseSha, manifest.candidateSha].every(value => /^[a-f0-9]{40}$/.test(value)) ||
      manifest.tag !== `v${manifest.version}` || !/^\d+$/.test(manifest.runId)) throw new Error('Invalid release manifest.');
  nextVersion(manifest.version, 'patch');
  git(root, 'fetch', path.resolve(directory, 'candidate.bundle'), 'HEAD');
  if (git(root, 'rev-parse', 'FETCH_HEAD') !== manifest.candidateSha) throw new Error('Candidate bundle SHA mismatch.');
  if (git(root, 'show', '-s', '--format=%P', manifest.candidateSha) !== manifest.baseSha) throw new Error('Candidate parent mismatch.');
  if (git(root, 'show', '-s', '--format=%s', manifest.candidateSha) !== `chore: release ${manifest.tag} (run ${manifest.runId})`) throw new Error('Candidate identity mismatch.');
  git(root, 'checkout', '--detach', manifest.candidateSha);
  if (JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version !== manifest.version) throw new Error('Candidate version mismatch.');
  return manifest;
}

export function publicationState(manifest, remoteMain, remoteTag) {
  if (remoteTag) {
    if (remoteTag !== manifest.candidateSha) throw new Error(`Tag collision: ${manifest.tag}`);
    return 'resume';
  }
  if (remoteMain !== manifest.baseSha) throw new Error('main changed since release preparation; start a new manual release.');
  return 'push';
}

export function pushCandidate(root, manifest) {
  const refs = git(root, 'ls-remote', 'origin', 'refs/heads/main', `refs/tags/${manifest.tag}`).split('\n');
  const sha = ref => refs.find(line => line.endsWith(`\t${ref}`))?.split('\t')[0];
  const state = publicationState(manifest, sha('refs/heads/main'), sha(`refs/tags/${manifest.tag}`));
  if (state === 'push') git(root, 'push', '--atomic', `--force-with-lease=refs/heads/main:${manifest.baseSha}`, 'origin',
    `${manifest.candidateSha}:refs/heads/main`, `${manifest.candidateSha}:refs/tags/${manifest.tag}`);
  return state;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, directory] = process.argv.slice(2);
  const root = process.cwd();
  if (!directory || !['prepare', 'apply', 'push'].includes(command)) throw new Error('Usage: release-version.mjs prepare|apply|push candidate-directory');
  let manifest;
  if (command === 'prepare') {
    if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Manual releases must run on main.');
    manifest = await prepare(root, directory, process.env.BUMP ?? 'patch', process.env.GITHUB_RUN_ID, process.env.PREVIOUS_TAG);
  } else {
    manifest = await applyCandidate(root, directory);
    if (process.env.GITHUB_RUN_ID !== manifest.runId) throw new Error('Candidate belongs to a different workflow run.');
    if (command === 'push') console.log(`Release publication: ${pushCandidate(root, manifest)}`);
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
    `base_sha=${manifest.baseSha}\ncandidate_sha=${manifest.candidateSha}\nversion=${manifest.version}\ntag=${manifest.tag}\nprevious_tag=${manifest.previousTag}\n`);
}
