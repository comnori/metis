import type { Document, PreprocessorReader, Inline, AbstractBlock } from '@asciidoctor/core';
import type { AnchorSymbol, AttributeDeclaration, AttributeUse, ConditionInfo, Relation, SourceLocation } from '@metis/contracts';
import { sourceCursor } from './source-cursor';
type Locate = (file: unknown, line: number) => SourceLocation;
type Converter = { convert(node: AbstractBlock | Inline, transform?: string, opts?: unknown): Promise<string> };
export function semanticObserver(locate: Locate) {
  const attributes: AttributeDeclaration[] = [], attributeUses: AttributeUse[] = [], conditions: ConditionInfo[] = [], relations: Relation[] = [];
  const declarations = new Map<string, AttributeDeclaration>();
  const lines = new Map<string, Map<string, SourceLocation>>();
  let collecting = true;
  function observe(doc: Document, reader: PreprocessorReader) {
    const processLine = reader.processLine.bind(reader);
    const stack: Array<boolean | undefined> = [];
    reader.processLine = async raw => {
      const source = locate(reader.file, reader.lineno);
      const condition = /^(ifdef|ifndef|ifeval)::([^[]*)\[(.*)\]$/.exec(raw);
      if (condition) {
        const parent = stack.every(Boolean), unknownParent = stack.includes(undefined);
        let enabled: boolean | undefined;
        if (condition[1] !== 'ifeval') {
          const names = condition[2].toLowerCase();
          const matches = names.includes(',') ? names.split(',').some(name => doc.hasAttribute(name)) : names.split('+').every(name => doc.hasAttribute(name));
          enabled = condition[1] === 'ifdef' ? matches : !matches;
        }
        const state = stack.includes(false) ? 'inactive' : enabled === undefined || unknownParent ? 'unknown' : enabled ? 'active' : 'inactive';
        conditions.push({ ...source, expression: raw, state, reason: state === 'unknown' ? '평가식 또는 상위 평가식: Asciidoctor 결과를 따르며 상세 판정은 미지원' : !parent ? '상위 조건이 비활성' : enabled ? '현재 위치의 속성 조건 충족' : '현재 위치의 속성 조건 불충족' });
        if (!condition[3] || condition[1] === 'ifeval') stack.push(state === 'unknown' ? undefined : state === 'active');
      } else if (/^endif::/.test(raw)) stack.pop();
      const result = await processLine(raw);
      if (result === raw && raw.trim()) {
        const entries = lines.get(raw) ?? new Map<string, SourceLocation>();
        entries.set(`${source.relativePath}:${source.line}`, source); lines.set(raw, entries);
      }
      const declaration = /^:(!?[\w-]+!?):(?:\s*(.*))?$/.exec(raw);
      if (declaration) {
        const name = declaration[1].replaceAll('!', '').toLowerCase();
        const key = `${source.relativePath}:${source.line}:${name}`;
        if (!declarations.has(key)) {
          const entry = { ...source, name, value: declaration[1].includes('!') ? '(해제)' : declaration[2] ?? '', applied: false };
          declarations.set(key, entry); attributes.push(entry);
        }
      }
      return result;
    };
    const mark = (name: string, value: string) => {
      if (!collecting) return;
      const source = locate(reader.file, reader.lineno);
      const candidates = attributes.filter(entry => entry.name === name && entry.relativePath === source.relativePath && entry.line <= source.line + 1);
      const entry = candidates.at(-1); if (entry) { entry.applied = true; entry.value = value; }
    };
    const set = doc.setAttribute.bind(doc), remove = doc.deleteAttribute.bind(doc);
    doc.setAttribute = (name, value) => { const result = set(name, value); if (result !== null) mark(name, result); return result; };
    doc.deleteAttribute = name => { const result = remove(name); if (result) mark(name, '(해제)'); return result; };
    const converter = doc.getConverter() as Converter;
    const convert = converter.convert.bind(converter);
    const seen = new WeakSet<object>();
    converter.convert = async (node, transform, opts) => {
      if (!seen.has(node)) {
        seen.add(node);
        const parent = node.getParent() as AbstractBlock | undefined;
        const cursor = 'getSourceLocation' in node ? node.getSourceLocation() : parent?.getSourceLocation?.();
        const position = sourceCursor(cursor);
        let source = locate(position.file, position.line);
        let sourceUncertain = false;
        // Include-boundary lookahead can return the parent's cursor. Recover
        // only uniquely evidenced origins from the parser's active lines.
        const sourceBlock = (parent as AbstractBlock & { getSource?(): string })?.getSource?.();
        if (sourceBlock) {
          const candidates = [...(lines.get(sourceBlock.split('\n')[0])?.values() ?? [])];
          if (!candidates.some(candidate => candidate.relativePath === source.relativePath && candidate.line === source.line)) {
            if (candidates.length === 1) source = candidates[0];
            else sourceUncertain = true;
          }
        }
        if (node.getNodeName() === 'inline_anchor' && (node as Inline).getType() === 'xref') {
          const attrs = node.getAttributes();
          const target = attrs.path ? `${String(attrs.path).replace(/\.html$/, '.adoc')}${attrs.fragment ? `#${attrs.fragment}` : ''}` : String(attrs.refid ?? (node as Inline).getTarget() ?? '').replace(/^#/, '');
          relations.push({ ...source, kind: 'xref', target, state: 'unchecked', ...(sourceUncertain ? { sourceUncertain: true, message: '정확한 참조 출처를 확인하지 못했습니다.' } : {}) });
        }
        const block = node as AbstractBlock & { getSource?(): string };
        if (block.getSubstitutions?.().includes('attributes') && block.getSource) {
          for (const [offset, line] of block.getSource().split('\n').entries()) for (const match of line.matchAll(/(?<!\\)\{([\w-]+)\}/g)) {
            const name = match[1];
            attributeUses.push({ ...locate(position.file, position.line + offset), name, value: doc.hasAttribute(name) ? String(doc.getAttribute(name)) : undefined });
          }
        }
      }
      return convert(node, transform, opts);
    };
    return reader;
  }
  function anchors(doc: Document): AnchorSymbol[] {
    return Object.entries(doc.getCatalog().refs as Record<string, AbstractBlock>).map(([id, node]) => {
      const parent = node.getParent?.() as AbstractBlock | undefined;
      const cursor = node.getSourceLocation?.() ?? parent?.getSourceLocation?.();
      const position = sourceCursor(cursor);
      return { id, title: node.getTitle?.() ?? id, ...locate(position.file, position.line) };
    });
  }
  function blockSource(source: SourceLocation, text: string): SourceLocation & { sourceUncertain?: boolean } {
    if (!text) return source;
    const candidates = [...(lines.get(text.split('\n')[0])?.values() ?? [])];
    if (candidates.some(candidate => candidate.relativePath === source.relativePath && candidate.line === source.line)) return source;
    if (candidates.length === 1) return candidates[0];
    return { ...source, sourceUncertain: true };
  }
  return { observe, anchors, blockSource, finishParse: () => { collecting = false; }, attributes, attributeUses, conditions, relations };
}
