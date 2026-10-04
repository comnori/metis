import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { applyCandidate, git, nextVersion, prepare, publicationState, pushCandidate, versionFiles } from './release-version.mjs';
import { publish, verifyExistingRelease } from './publish-release.mjs';
import { resolveTarget } from './validation-target.mjs';

const temporaryDirectories = [];
async function temporary(prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
after(async () => {
  for (const directory of temporaryDirectories) {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('metis-')) throw new Error('Unsafe test cleanup path.');
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await temporary('metis-version-');
  const packages = ['', 'apps/desktop', 'packages/core'];
  for (const directory of packages) {
    await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(path.join(root, directory, 'package.json'), JSON.stringify({
      name: directory || 'metis', version: '0.2.3', ...(directory ? {} : { workspaces: ['apps/*', 'packages/*'] })
    }, null, 2));
  }
  await mkdir(path.join(root, 'experiments/demo'), { recursive: true });
  await writeFile(path.join(root, 'experiments/demo/package.json'), '{"version":"9.0.0"}');
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ version: '0.2.3', lockfileVersion: 3,
    packages: Object.fromEntries([...packages.map(directory => [directory, { version: '0.2.3' }]),
      ['node_modules/dependency', { version: '4.5.6', integrity: 'unchanged' }]]) }, null, 2));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Release Test');
  git(root, 'config', 'user.email', 'release@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'Initial');
  return root;
}

test('stable version increments reset lower components and reject invalid input', () => {
  assert.equal(nextVersion('0.2.3', 'patch'), '0.2.4');
  assert.equal(nextVersion('0.2.3', 'minor'), '0.3.0');
  assert.equal(nextVersion('0.2.3', 'major'), '1.0.0');
  assert.equal(nextVersion('1.9.99', 'minor'), '1.10.0');
  for (const value of ['v0.2.3', '01.2.3', '0.2', '0.2.3-beta', '9007199254740992.0.0']) assert.throws(() => nextVersion(value, 'patch'));
  assert.throws(() => nextVersion('0.2.3', 'auto'));
});

test('workspace and lockfile versions stay synchronized without modifying experiments or dependencies', async () => {
  const root = await fixture();
  const updates = await versionFiles(root, '0.3.0');
  assert.deepEqual([...updates.keys()].sort(), ['apps/desktop/package.json', 'package-lock.json', 'package.json', 'packages/core/package.json']);
  for (const [file, contents] of updates) {
    if (file !== 'package-lock.json') assert.equal(JSON.parse(contents).version, '0.3.0');
  }
  const lock = JSON.parse(updates.get('package-lock.json'));
  assert.equal(lock.version, '0.3.0');
  for (const directory of ['', 'apps/desktop', 'packages/core']) assert.equal(lock.packages[directory].version, '0.3.0');
  assert.deepEqual(lock.packages['node_modules/dependency'], { version: '4.5.6', integrity: 'unchanged' });
  assert.equal(await readFile(path.join(root, 'experiments/demo/package.json'), 'utf8'), '{"version":"9.0.0"}');
  await writeFile(path.join(root, 'packages/core/package.json'), '{"version":"0.2.2"}');
  await assert.rejects(versionFiles(root, '0.3.0'), /Version mismatch/);
});

test('lockfile drift fails before writing any version files', async () => {
  const root = await fixture();
  const before = await readFile(path.join(root, 'package.json'), 'utf8');
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  lock.packages['apps/desktop'].version = '0.2.2';
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lock));
  await assert.rejects(versionFiles(root, '0.3.0'), /Lockfile version mismatch/);
  assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), before);
});

test('existing prefixed or unprefixed release tags block preparation without changing versions', async () => {
  for (const tag of ['v0.2.4', '0.2.4']) {
    const root = await fixture();
    git(root, 'tag', tag);
    await assert.rejects(prepare(root, path.join(root, 'candidate'), 'patch', '123'), /already exists/);
    assert.equal(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, '0.2.3');
  }
});

test('publication rejects main drift and tag collisions and resumes the exact candidate', () => {
  const manifest = { baseSha: 'base', candidateSha: 'candidate', tag: 'v0.2.4' };
  assert.equal(publicationState(manifest, 'base'), 'push');
  assert.throws(() => publicationState(manifest, 'changed'), /main changed/);
  assert.throws(() => publicationState(manifest, 'candidate', 'different'), /Tag collision/);
  assert.equal(publicationState(manifest, 'candidate', 'candidate'), 'resume');
  assert.equal(publicationState(manifest, 'later-main', 'candidate'), 'resume');
});

test('candidate bundle pins the version commit; failed validation leaves remote untouched; publication is atomic and repeatable', async () => {
  const root = await fixture();
  const remote = await temporary('metis-remote-');
  git(remote, 'init', '--bare');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', 'origin', 'main');
  git(root, 'checkout', '--detach');
  const candidate = path.join(root, 'candidate');
  const manifest = await prepare(root, candidate, 'patch', '123', 'v0.2.3');
  assert.equal(git(root, 'ls-remote', 'origin', 'refs/heads/main').split('\t')[0], manifest.baseSha);
  assert.equal(git(root, 'ls-remote', 'origin', `refs/tags/${manifest.tag}`), '');
  const consumer = await temporary('metis-consumer-');
  git(consumer, 'clone', '--branch', 'main', remote, '.');
  assert.deepEqual(await applyCandidate(consumer, candidate), manifest);
  assert.equal(git(consumer, 'rev-parse', 'HEAD'), manifest.candidateSha);
  assert.equal(JSON.parse(await readFile(path.join(consumer, 'apps/desktop/package.json'), 'utf8')).version, '0.2.4');
  assert.equal(pushCandidate(consumer, manifest), 'push');
  for (const ref of ['refs/heads/main', `refs/tags/${manifest.tag}`]) assert.equal(git(root, 'ls-remote', 'origin', ref).split('\t')[0], manifest.candidateSha);
  assert.equal(pushCandidate(consumer, manifest), 'resume');
  await writeFile(path.join(candidate, 'manifest.json'), JSON.stringify({ ...manifest, candidateSha: manifest.baseSha }));
  await assert.rejects(applyCandidate(root, candidate), /bundle SHA mismatch/);
});

test('changed remote main prevents publication and leaves the release tag absent', async () => {
  const root = await fixture();
  const remote = await temporary('metis-drift-');
  git(remote, 'init', '--bare');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', 'origin', 'main');
  git(root, 'checkout', '--detach');
  const manifest = await prepare(root, path.join(root, 'candidate'), 'patch', '123');
  git(root, 'checkout', 'main');
  git(root, 'commit', '--allow-empty', '-m', 'Concurrent change');
  git(root, 'push', 'origin', 'main');
  assert.throws(() => pushCandidate(root, manifest), /main changed/);
  assert.equal(git(root, 'ls-remote', 'origin', `refs/tags/${manifest.tag}`), '');
});

test('existing releases must be stable and have exactly the expected assets', () => {
  const release = { tagName: 'v0.2.4', isDraft: false, isPrerelease: false, assets: [{ name: 'app.zip' }, { name: 'SHA256SUMS.txt' }] };
  verifyExistingRelease(release, 'v0.2.4', ['SHA256SUMS.txt', 'app.zip']);
  assert.throws(() => verifyExistingRelease({ ...release, isDraft: true }, 'v0.2.4', []));
  assert.throws(() => verifyExistingRelease(release, 'v0.2.5', []));
  assert.throws(() => verifyExistingRelease(release, 'v0.2.4', ['different.zip']), /assets/);
});

async function publicationFixture() {
  const root = await temporary('metis-publication-');
  const candidate = path.join(root, 'candidate');
  const assets = path.join(root, 'assets');
  const evidence = path.join(root, 'evidence');
  for (const directory of [candidate, assets, evidence]) await mkdir(directory);
  const manifest = { version: '0.2.4', tag: 'v0.2.4', runId: '123', candidateSha: 'b'.repeat(40) };
  await writeFile(path.join(candidate, 'manifest.json'), JSON.stringify(manifest));
  for (const name of ['windows', 'macos', 'linux']) await writeFile(path.join(assets, `${name}.zip`), name);
  const checksums = 'candidate checksums\n';
  await writeFile(path.join(evidence, 'SHA256SUMS.txt'), checksums);
  await writeFile(path.join(evidence, 'virustotal-results.json'), '{}');
  await writeFile(path.join(evidence, 'release-notes.md'), 'Security verification passed.');
  const state = { release: null, calls: [], failUpload: false, losePublishResponse: false, checksums };
  const commands = {
    git: () => `${manifest.candidateSha}\trefs/tags/${manifest.tag}`,
    view: async () => state.release && structuredClone(state.release),
    gh: async args => {
      state.calls.push(args[1]);
      if (args[1] === 'create') {
        assert.ok(args.includes('--draft'));
        state.release = { tagName: manifest.tag, isDraft: true, isPrerelease: false, assets: [],
          body: await readFile(args[args.indexOf('--notes-file') + 1], 'utf8') };
      } else if (args[1] === 'upload') {
        assert.ok(state.release.isDraft);
        const files = args.slice(3, -1);
        assert.equal(args.at(-1), '--clobber');
        state.release.assets = files.map(file => ({ name: path.basename(file) }));
        if (state.failUpload) {
          state.release.assets = state.release.assets.slice(0, 1);
          state.failUpload = false;
          throw new Error('Interrupted upload');
        }
      } else if (args[1] === 'download') {
        await writeFile(path.join(args[args.indexOf('--dir') + 1], 'SHA256SUMS.txt'), state.checksums);
      } else if (args[1] === 'edit') {
        assert.ok(args.includes('--draft=false'));
        state.release.isDraft = false;
        if (state.losePublishResponse) {
          state.losePublishResponse = false;
          throw new Error('Lost publication response');
        }
      } else assert.fail(`Unexpected command: ${args[1]}`);
    }
  };
  return { args: [candidate, assets, evidence, commands], state, manifest };
}

test('release draft uploads and verifies files before publication; repeated publication is a no-op', async () => {
  const { args, state } = await publicationFixture();
  await publish(...args);
  assert.deepEqual(state.calls, ['create', 'upload', 'download', 'edit']);
  assert.equal(state.release.isDraft, false);
  await publish(...args);
  assert.deepEqual(state.calls, ['create', 'upload', 'download', 'edit', 'download']);
});

test('partial upload and lost publication responses recover on the same release without duplication', async () => {
  const { args, state } = await publicationFixture();
  state.failUpload = true;
  await assert.rejects(publish(...args), /Interrupted upload/);
  assert.equal(state.release.isDraft, true);
  state.losePublishResponse = true;
  await assert.rejects(publish(...args), /Lost publication response/);
  assert.equal(state.release.isDraft, false);
  await publish(...args);
  assert.equal(state.calls.filter(command => command === 'create').length, 1);
  assert.equal(state.calls.filter(command => command === 'edit').length, 1);
});

test('checksum mismatch blocks publication and candidate mismatch blocks draft modification', async () => {
  const { args, state } = await publicationFixture();
  state.checksums = 'different candidate checksums';
  await assert.rejects(publish(...args), /checksums do not match/);
  assert.equal(state.release.isDraft, true);
  assert.ok(!state.calls.includes('edit'));
  state.release.body = 'Another workflow run';
  const count = state.calls.length;
  await assert.rejects(publish(...args), /different candidate/);
  assert.equal(state.calls.length, count);
  args[3].git = () => 'wrong-sha\trefs/tags/v0.2.4';
  await assert.rejects(publish(...args), /tag does not match/);
});

test('Full targets main or a frozen open PR merge SHA, with bounded mergeability retries', async () => {
  const sha = 'a'.repeat(40);
  assert.equal(await resolveTarget('', async endpoint => { assert.equal(endpoint, 'commits/main'); return { sha }; }), sha);
  let attempts = 0;
  assert.equal(await resolveTarget('42', async endpoint => {
    assert.equal(endpoint, 'pulls/42');
    return { state: 'open', base: { ref: 'main' }, mergeable: ++attempts > 1 ? true : null, merge_commit_sha: sha };
  }, async () => {}), sha);
  assert.equal(attempts, 2);
  await assert.rejects(resolveTarget('42; echo unsafe', async () => {}), /positive integer/);
  await assert.rejects(resolveTarget('42', async () => ({ state: 'closed', base: { ref: 'main' } })), /open PR/);
  await assert.rejects(resolveTarget('42', async () => ({ state: 'open', base: { ref: 'other' } })), /targeting main/);
  await assert.rejects(resolveTarget('42', async () => ({ state: 'open', base: { ref: 'main' }, mergeable: false })), /conflicts/);
  await assert.rejects(resolveTarget('42', async () => ({ state: 'open', base: { ref: 'main' }, mergeable: null }), async () => {}), /retry Full/);
  await assert.rejects(resolveTarget('404', async () => { throw new Error('Not Found'); }), /Not Found/);
});

test('workflow event contracts keep heavy checks and publication manual', async () => {
  const workflows = path.resolve(import.meta.dirname, '../.github/workflows');
  const source = async file => (await readFile(path.join(workflows, file), 'utf8')).replaceAll('\r\n', '\n');
  const events = text => [...text.match(/^on:\n([\s\S]*?)(?=^\S)/m)[1].matchAll(/^  ([a-z_]+):/gm)].map(match => match[1]);
  const core = await source('desktop-core-validation.yml');
  const full = await source('desktop-validation.yml');
  const release = await source('release.yml');
  assert.deepEqual(events(core), ['pull_request']);
  assert.deepEqual(events(full), ['workflow_dispatch']);
  assert.deepEqual(events(release), ['workflow_dispatch']);
  assert.match(core, /types: \[opened, synchronize, reopened\]/);
  assert.match(core, /cancel-in-progress: true/);
  assert.match(core, /os: \[windows-2022, macos-14, ubuntu-22.04\]/);
  assert.match(core, /run: npm run check/);
  assert.doesNotMatch(core, /npm run (package|test:integration)/);
  assert.match(full, /ref: \$\{\{ needs.target.outputs.sha \}\}/);
  assert.match(full, /pr_number:/);
  assert.match(full, /npm run test:integration:packaged/);
  assert.match(release, /cancel-in-progress: false/);
  assert.match(release, /needs: \[prepare, package\]/);
  assert.match(release, /options: \[patch, minor, major\]/);
  assert.match(release, /run: npm run check/);
  assert.doesNotMatch(release, /npm run test:integration/);
  assert.ok(release.indexOf('Enforce security verification') < release.indexOf('Atomically push version commit and tag'));
});
