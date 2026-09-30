import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePullRequest } from './pr-policy.mjs';

const pr = (title = 'feat(editor): add split view', labels = ['type:feature']) => ({ title, labels: labels.map(name => ({ name })) });
test('Conventional Commits titles accept scopes and breaking markers', () => {
  for (const title of ['feat(editor): add split view', 'fix: correct parsing', 'refactor(core)!: change plugin contract', 'docs: explain Git policy']) {
    assert.deepEqual(validatePullRequest(pr(title)), []);
  }
});
test('invalid and multiline titles fail', () => {
  for (const title of ['Update docs', 'feat:', 'feat: ', 'feat(): empty scope', 'feat: valid\nsecond line']) assert.ok(validatePullRequest(pr(title)).length);
});
test('a supported classification is required; area and version are not substitutes', () => {
  for (const labels of [[], ['area:editor'], ['version:minor']]) assert.ok(validatePullRequest(pr(undefined, labels)).length);
});
test('unknown classifications fail even alongside a supported type', () => {
  for (const labels of [['type:unknown'], ['type:bug', 'type:unknown']]) assert.ok(validatePullRequest(pr(undefined, labels)).length);
});
test('breaking may stand alone or accompany another classification', () => {
  for (const labels of [['type:breaking'], ['type:feature', 'type:breaking', 'area:editor']]) assert.deepEqual(validatePullRequest(pr(undefined, labels)), []);
});
test('unrelated labels and shell metacharacters are data', () => {
  assert.deepEqual(validatePullRequest(pr('fix: handle $(example) and `code`', ['type:bug', 'help wanted'])), []);
});
