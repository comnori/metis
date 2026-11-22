// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { DiagramCache, scopeDiagramSvg } from './diagram-cache';

test('diagram cache evicts by size and recent usage', () => {
  const cache = new DiagramCache<string>(20, 2);
  cache.set('a', 'first', 5); cache.set('b', 'second', 5); cache.get('a'); cache.set('c', 'third', 5);
  expect(cache.get('b')).toBeUndefined(); expect(cache.get('a')).toBe('first');
  cache.set('d', 'big', 30); expect(cache.get('d')).toBeUndefined();
  cache.clear(); expect(cache.get('a')).toBeUndefined();
});

test('cached SVG instances keep local CSS, markers, links and accessible labels independent', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" id="diagram" aria-labelledby="title"><style>#diagram .label{fill:#fff}#diagram #arrow{stroke:red}</style><title id="title">Diagram</title><defs><marker id="arrow"/></defs><path marker-end="url(#arrow)"/><a href="#title"><text>Label</text></a></svg>';
  const result = scopeDiagramSvg(svg, 'instance');
  expect(result).toContain('#instance-0 .label{fill:#fff}');
  expect(result).toContain('#instance-0 #instance-2');
  expect(result).toContain('aria-labelledby="instance-1"');
  expect(result).toContain('url(#instance-2)'); expect(result).toContain('href="#instance-1"');
});
