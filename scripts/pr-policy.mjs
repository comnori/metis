import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const changeTypes = ['feature', 'bug', 'breaking', 'performance', 'refactor', 'docs', 'chore'];

export function validatePullRequest(pr) {
  const errors = [];
  if (!/^(feat|fix|perf|refactor|docs|test|build|ci|chore|style|revert)(\([^()\r\n]+\))?!?: \S[^\r\n]*$/.test(pr?.title ?? '')) {
    errors.push('Use a Conventional Commits title, e.g. feat(editor): add split view.');
  }
  const types = (pr?.labels ?? []).map(label => label.name).filter(name => name?.startsWith('type:'));
  if (!types.some(name => changeTypes.includes(name.slice(5)))) errors.push('Add at least one supported type:* label.');
  if (types.some(name => !changeTypes.includes(name.slice(5)))) errors.push(`Supported labels: ${changeTypes.map(type => `type:${type}`).join(', ')}.`);
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (!event.pull_request) throw new Error('Expected a pull_request event.');
  const errors = validatePullRequest(event.pull_request);
  for (const error of errors) console.error(error);
  process.exitCode = errors.length ? 1 : 0;
}
