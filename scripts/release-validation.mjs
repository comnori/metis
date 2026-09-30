import { pathToFileURL } from 'node:url';

export const fullJobs = ['windows-2022', 'macos-14', 'ubuntu-22.04'].map(os => `Desktop full / ${os}`);

export async function verifyReleaseValidation({ repository, sha, request }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Expected repository and resolved commit SHA.');
  const base = `/repos/${repository}/actions`;
  async function all(endpoint, key) {
    const values = [];
    for (let page = 1; ; page++) {
      const data = await request(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(data[key])) throw new Error(`Invalid GitHub response: ${key}`);
      values.push(...data[key]);
      if (data[key].length < 100) return values;
    }
  }
  const runs = await all(`${base}/workflows/desktop-validation.yml/runs?branch=main&event=workflow_dispatch&head_sha=${sha}`, 'workflow_runs');
  const run = runs.filter(run => run.head_sha === sha && run.head_branch === 'main' && run.event === 'workflow_dispatch')
    .sort((a, b) => b.id - a.id)[0];
  if (!run || run.status !== 'completed' || run.conclusion !== 'success') throw new Error('Latest manual full validation for this main commit has not succeeded.');
  if (!Number.isInteger(run.id) || !Number.isInteger(run.run_attempt) || run.run_attempt < 1) throw new Error('Invalid validation run identity.');
  const jobs = await all(`${base}/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
  for (const name of fullJobs) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') throw new Error(`Full validation missing or unsuccessful: ${name}`);
  }
  return run;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const run = await verifyReleaseValidation({ repository: process.env.GITHUB_REPOSITORY, sha: process.env.RELEASE_COMMIT,
      request: async endpoint => {
        const response = await fetch(`https://api.github.com${endpoint}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`GitHub validation lookup failed: HTTP ${response.status}`);
        return response.json();
      } });
    console.log(`Validated ${run.head_sha}: ${run.html_url}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
