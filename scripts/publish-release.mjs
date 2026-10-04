import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { git } from './release-version.mjs';

export function verifyExistingRelease(release, tag, names) {
  if (release.tagName !== tag || release.isDraft || release.isPrerelease) throw new Error('Existing release is not the expected stable release.');
  const actual = release.assets.map(asset => asset.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...names].sort())) throw new Error('Existing release assets do not match this candidate.');
}

const gh = args => execFileSync('gh', args, { encoding: 'utf8' });
const view = tag => {
  const result = spawnSync('gh', ['release', 'view', tag, '--json', 'tagName,isDraft,isPrerelease,assets,body'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result.status === 0 ? JSON.parse(result.stdout) : null;
};

export async function publish(directory, assets, evidence, commands = { git, gh, view }) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const tagSha = commands.git(process.cwd(), 'ls-remote', 'origin', `refs/tags/${manifest.tag}`).split('\t')[0];
  if (tagSha !== manifest.candidateSha) throw new Error('Remote release tag does not match the candidate.');
  const files = [
    ...(await readdir(assets)).filter(name => name.endsWith('.zip')).sort().map(name => path.join(assets, name)),
    path.join(evidence, 'SHA256SUMS.txt'), path.join(evidence, 'virustotal-results.json')
  ];
  const marker = `<!-- metis-release-run:${manifest.runId} candidate:${manifest.candidateSha} -->`;
  let existing = await commands.view(manifest.tag);
  if (existing && (!existing.body?.includes(marker) || existing.tagName !== manifest.tag || existing.isPrerelease)) {
    throw new Error('Existing release belongs to a different candidate.');
  }
  const verifyPublishedAssets = async release => {
    verifyExistingRelease({ ...release, isDraft: false }, manifest.tag, files.map(file => path.basename(file)));
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'metis-release-'));
    try {
      await commands.gh(['release', 'download', manifest.tag, '--pattern', 'SHA256SUMS.txt', '--dir', temporary]);
      if (!(await readFile(path.join(temporary, 'SHA256SUMS.txt'))).equals(await readFile(path.join(evidence, 'SHA256SUMS.txt')))) {
        throw new Error('Existing release checksums do not match this candidate.');
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  };
  if (existing && !existing.isDraft) {
    await verifyPublishedAssets(existing);
    console.log(`Release ${manifest.tag} already published and verified.`);
    return;
  }
  if (!existing) {
    const notes = path.join(evidence, 'publication-notes.md');
    await writeFile(notes, `${await readFile(path.join(evidence, 'release-notes.md'), 'utf8')}\n${marker}\n`);
    await commands.gh(['release', 'create', manifest.tag, '--draft', '--verify-tag', '--title', manifest.version,
      '--notes-file', notes, '--generate-notes']);
  } else {
    const names = files.map(file => path.basename(file));
    if (existing.assets.some(asset => !names.includes(asset.name))) throw new Error('Draft contains unexpected release assets.');
  }
  await commands.gh(['release', 'upload', manifest.tag, ...files, '--clobber']);
  existing = await commands.view(manifest.tag);
  if (!existing?.isDraft || !existing.body?.includes(marker)) throw new Error('Release draft changed during publication.');
  await verifyPublishedAssets(existing);
  await commands.gh(['release', 'edit', manifest.tag, '--draft=false']);
  console.log(`Release ${manifest.tag} published.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 3) throw new Error('Usage: publish-release.mjs candidate-directory assets-directory evidence-directory');
  await publish(...args);
}
