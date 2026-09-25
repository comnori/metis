import { expect, test } from 'vitest';
import { relatedDocuments } from './related';
import type { WorkspaceRelation } from '@metis/contracts';
const edge = (from: string, to: string, kind: 'xref' | 'include' = 'xref', context = from): WorkspaceRelation => ({ relativePath: from, targetPath: to, target: to, kind, documentPath: context, state: 'resolved', line: 3, revision: 'a'.repeat(64) });
test('direct incoming and outgoing references and includes explain their direction', () => {
  const result = relatedDocuments([edge('a', 'b'), edge('c', 'a', 'include')], 'a');
  expect(result.documents.map(doc => [doc.path, doc.reasons[0].kind])).toEqual([['b', 'outgoing'], ['c', 'incoming']]);
});
test('common reference requires evidence from both documents', () => {
  const result = relatedDocuments([edge('a', 'shared'), edge('b', 'shared')], 'a');
  const reason = result.documents.find(doc => doc.path === 'b')!.reasons[0];
  expect(reason.kind).toBe('common'); expect(reason.via).toBe('shared');
  expect(reason.edges.map(edge => edge.relativePath)).toEqual(['a', 'b']);
});
test('missing, blocked, uncertain and self links cannot fabricate related documents', () => {
  expect(relatedDocuments([{ ...edge('a', 'b'), state: 'missing' }, { ...edge('a', 'c'), state: 'blocked' }, { ...edge('a', 'd'), sourceUncertain: true }, edge('a', 'a')], 'a').documents).toEqual([]);
});
test('context evidence remains distinct and original relation data is unchanged', () => {
  const edges = [edge('a', 'b', 'xref', 'public'), edge('a', 'b', 'xref', 'internal')], before = JSON.stringify(edges);
  const result = relatedDocuments(edges, 'a');
  expect(result.documents[0].reasons.map(reason => reason.edges[0].documentPath)).toEqual(['public', 'internal']);
  expect(JSON.stringify(edges)).toBe(before);
});
test('document and evidence limits are explicit', () => {
  const many = Array.from({ length: 20 }, (_, i) => edge('a', `b${i}`));
  const result = relatedDocuments(many, 'a', 12); expect(result.documents).toHaveLength(12); expect(result.truncated).toBe(true);
  const repeated = relatedDocuments(Array.from({ length: 8 }, (_, i) => edge('a', 'b', 'xref', `context${i}`)), 'a');
  expect(repeated.documents[0].reasons).toHaveLength(5); expect(repeated.truncated).toBe(true);
});
test('fresh relation data removes related documents after reference removal', () => {
  expect(relatedDocuments([edge('a', 'shared'), edge('b', 'shared')], 'a').documents).toHaveLength(2);
  expect(relatedDocuments([edge('a', 'shared')], 'a').documents.map(doc => doc.path)).toEqual(['shared']);
});
