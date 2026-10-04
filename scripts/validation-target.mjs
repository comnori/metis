import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function resolveTarget(prNumber, api, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!prNumber) return (await api('commits/main')).sha;
  if (!/^[1-9]\d*$/.test(prNumber)) throw new Error('pr_number must be a positive integer.');
  for (let attempt = 0; attempt < 6; attempt++) {
    const pr = await api(`pulls/${prNumber}`);
    if (pr.state !== 'open' || pr.base.ref !== 'main') throw new Error('Full requires an open PR targeting main.');
    if (pr.mergeable === false) throw new Error(`PR #${prNumber} cannot be merged; resolve conflicts before Full.`);
    if (pr.mergeable === true && /^[a-f0-9]{40}$/.test(pr.merge_commit_sha ?? '')) return pr.merge_commit_sha;
    if (attempt < 5) await sleep(2000);
  }
  throw new Error(`GitHub could not resolve a merge commit for PR #${prNumber}; retry Full later.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.GH_REPO;
  const sha = await resolveTarget(process.env.PR_NUMBER ?? '', endpoint =>
    JSON.parse(execFileSync('gh', ['api', `repos/${repo}/${endpoint}`], { encoding: 'utf8' })));
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid validation commit SHA.');
  await appendFile(process.env.GITHUB_OUTPUT, `sha=${sha}\n`);
  console.log(`Full target: ${sha}`);
}
