import { expect, test } from 'vitest';
import { parseProposal, selectProposal } from './proposals';
const input = (changes: unknown[]) => JSON.stringify({ version: 1, changes });
const change = (id: string, before: string, after: string) => ({ id, before, after, reason: '수정' });
test('selecting a subset preserves other text and uses original offsets', () => {
  const baseline = 'AAA BBB CCC'; const changes = parseProposal(input([change('b', 'BBB', 'longer'), change('a', 'AAA', '')]), baseline);
  expect(selectProposal(baseline, changes, [])).toBe(baseline);
  expect(selectProposal(baseline, changes, ['b'])).toBe('AAA longer CCC');
  expect(selectProposal(baseline, changes, ['a', 'b'])).toBe(' longer CCC');
  expect(baseline).toBe('AAA BBB CCC');
});
test('ambiguous, absent, overlapping and duplicated edits fail closed', () => {
  expect(() => parseProposal(input([change('a', 'AAA', 'x')]), 'AAA AAA')).toThrow('한 곳');
  expect(() => parseProposal(input([change('a', 'missing', 'x')]), 'AAA')).toThrow();
  expect(() => parseProposal(input([change('a', 'ABC', 'x'), change('b', 'BC', 'y')]), 'ABCD')).toThrow('겹칩니다');
  expect(() => parseProposal(input([change('a', 'AB', 'x'), change('a', 'CD', 'y')]), 'ABCD')).toThrow();
});
test('unsupported fields, nulls, empty context, malformed text and oversized input are rejected', () => {
  for (const value of [null, {}, { version: 1, changes: [] }, { version: 1, changes: [null] }, { version: 1, changes: [{ ...change('a', 'A', 'B'), path: '../outside' }] }]) expect(() => parseProposal(JSON.stringify(value), 'A')).toThrow();
  for (const c of [change('a', '', 'x'), change('a', 'A', 'A'), change('a', 'A', '\0'), change('a', 'A', '\r'), change('a', 'A', '\ud800')]) expect(() => parseProposal(input([c]), 'A')).toThrow();
  expect(() => parseProposal('x'.repeat(1024 * 1024 + 1), 'A')).toThrow('한도');
});
test('invalid selection and changed baseline cannot apply a previously parsed proposal', () => {
  const changes = parseProposal(input([change('a', 'A', 'B')]), 'A');
  expect(() => selectProposal('Z', changes, ['a'])).toThrow('바뀌었습니다');
  expect(() => selectProposal('A', changes, ['unknown'])).toThrow();
  expect(() => selectProposal('A', changes, ['a', 'a'])).toThrow();
});

test('evidence quotes resolve against the reviewed source and reject forged positions', () => {
  const baseline = 'AAA\n\nSupporting fact\n';
  const edit = { ...change('a', 'AAA', 'BBB'), evidence: [{ quote: 'Supporting fact' }] };
  expect(parseProposal(input([edit]), baseline)[0].evidence).toEqual([{ quote: 'Supporting fact', line: 3 }]);
  for (const evidence of [[], [{ quote: 'absent' }], [{ quote: 'Supporting fact', line: 1 }], [{ quote: 'Supporting fact', path: 'other.adoc' }], [{ quote: 'Supporting fact' }, { quote: 'Supporting fact' }], [{ quote: ' ' }]]) expect(() => parseProposal(input([{ ...edit, evidence }]), baseline)).toThrow();
  expect(() => parseProposal(input([edit]), baseline + 'Supporting fact')).toThrow('한 곳');
});
