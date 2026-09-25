import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'), run = path.join(root, '.pre04-runs', `m4-08-study-${Date.now()}`);
await mkdir(path.join(run, 'workspace', 'shared'), { recursive: true });
await mkdir(path.join(run, 'first-document'));
const files = {
  'workspace/guide.adoc': '= Study Guide\n\n== Overview\n\nGuide introduction.\n\ninclude::shared/part.adoc[]\n\n== Related\n\nxref:reference.adoc[]\n',
  'workspace/shared/part.adoc': '== Shared Part\n\nShared text to revise.\n',
  'workspace/reference.adoc': '= Reference\n\nSearch marker: study-needle\n\nxref:guide.adoc[]\n',
  'workspace/conflict.adoc': '= Conflict\n\nOriginal statement.\n',
  'workspace/proposal.adoc': '= Proposal\n\nAlpha text\n\nBeta text\n',
  'proposal.json': JSON.stringify({ version: 1, changes: [{ id: 'alpha', before: 'Alpha text', after: 'Alpha revised', reason: 'Fixed study suggestion A', evidence: [{ quote: 'Alpha text' }] }, { id: 'beta', before: 'Beta text', after: 'Beta revised', reason: 'Fixed study suggestion B', evidence: [{ quote: 'Beta text' }] }] }, null, 2),
  'record.json': JSON.stringify({ status: 'not-observed', participant: null, experience: null, consent: false, environment: {}, tasks: ['T1', 'T2', 'T3', 'T4', 'T5'].map(id => ({ id, attempt: null, success: null, elapsedMs: null, helpCount: null, backtrackCount: null, explanation: null, blocker: null })), note: 'Null means unmeasured. Do not substitute automated test durations.' }, null, 2)
};
for (const [name, content] of Object.entries(files)) await writeFile(path.join(run, name), content, { flag: 'wx' });
console.log(JSON.stringify({ run, instruction: 'Use docs/m4-08-observation.md. Generate a fresh fixture for each participant; no user documents were read.' }, null, 2));
