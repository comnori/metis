import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyReleaseValidation, fullJobs } from './release-validation.mjs';
const sha = 'a'.repeat(40);
const success = { id: 20, run_attempt: 2, head_sha: sha, head_branch: 'main', event: 'workflow_dispatch', status: 'completed', conclusion: 'success' };
const jobs = fullJobs.map(name => ({ name, status: 'completed', conclusion: 'success' }));
const verify = (runs = [success], entries = jobs, request) => verifyReleaseValidation({ repository: 'owner/repo', sha, request: request ?? (async url => url.includes('/jobs?') ? { jobs: entries } : { workflow_runs: runs }) });
test('accepts the matching manual main commit and all three successful OS jobs', async () => {
  const urls = [];
  assert.equal((await verify(undefined, undefined, async url => { urls.push(url); return url.includes('/jobs?') ? { jobs } : { workflow_runs: [success] }; })).id, 20);
  assert.ok(urls[1].includes('/attempts/2/jobs'));
});
test('rejects absent, different SHA, non-main and non-manual evidence', async () => {
  for (const runs of [[], [{ ...success, head_sha: 'b'.repeat(40) }], [{ ...success, head_branch: 'other' }], [{ ...success, event: 'pull_request' }]]) await assert.rejects(verify(runs));
});
test('latest run wins; an older success cannot mask failure or an active rerun', async () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped', null]) await assert.rejects(verify([success, { ...success, id: 21, conclusion }]));
  await assert.rejects(verify([{ ...success, status: 'in_progress' }]));
  await assert.rejects(verify([{ ...success, run_attempt: 3, conclusion: 'failure' }]));
});
test('requires each OS exactly once and never accepts skipped or incomplete jobs', async () => {
  await assert.rejects(verify(undefined, jobs.slice(1)));
  await assert.rejects(verify(undefined, [...jobs, jobs[0]]));
  for (const conclusion of ['failure', 'cancelled', 'skipped', null]) await assert.rejects(verify(undefined, [{ ...jobs[0], conclusion }, ...jobs.slice(1)]));
  await assert.rejects(verify(undefined, [{ ...jobs[0], status: 'in_progress' }, ...jobs.slice(1)]));
});
test('API failures and malformed responses fail closed', async () => {
  await assert.rejects(verify(undefined, undefined, async () => { throw new Error('HTTP 403'); }), /403/);
  await assert.rejects(verify(undefined, undefined, async () => ({})), /Invalid/);
});
test('paginates evidence and selects the newest matching run', async () => {
  const run = await verify(undefined, undefined, async url => url.includes('/jobs?') ? { jobs } : { workflow_runs: url.endsWith('page=1') ? Array.from({ length: 100 }, (_, id) => ({ ...success, id, head_sha: 'b'.repeat(40) })) : [success] });
  assert.equal(run.id, 20);
});
