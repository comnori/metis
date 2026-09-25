export { semanticDiff } from './semantic-diff';
import type { DocumentSnapshot, SemanticBlock } from '@metis/contracts';
export { buildContext } from './context';
import { load, Extensions, MemoryLogger, LoggerManager, type AbstractBlock } from '@asciidoctor/core';
import path from 'node:path';
import { semanticObserver } from './semantics';
import { sourceCursor } from './source-cursor';
import { Workspace } from '@metis/workspace';
import { BoundaryError, type Analysis, type Diagnostic, type OutlineEntry } from '@metis/contracts';
const maxBytes = 4 * 1024 * 1024;
export async function analyze(root: string, relativePath: string, text: string, resolveReferences = true, includeSources = true, context?: { sources: ReadonlyMap<string, DocumentSnapshot>; blocks: SemanticBlock[]; includeBlockedMessage?: string }): Promise<Analysis> {
  const workspace = new Workspace();
  const session = await workspace.open(root);
  let bytes = Buffer.byteLength(text), count = 0;
  if (bytes > 1024 * 1024) throw new BoundaryError('TOO_LARGE', '미리보기 원문 한도는 1 MiB입니다. 편집과 저장은 계속 사용할 수 있습니다.');
  const diagnostics: Diagnostic[] = [];
  const sources = new Map<string, { relativePath: string; lines?: number[] }>();
  const location = (file: unknown, line: number) => {
    const key = String(file || relativePath).replaceAll('\\', '/');
    const source = sources.get(key);
    return { relativePath: source?.relativePath ?? key, line: source?.lines?.[line - 1] ?? Math.max(1, line) };
  };
  const registry = Extensions.create();
  const semantic = semanticObserver(location);
  registry.preprocessor(function () { this.process((doc, reader) => semantic.observe(doc, reader)); });
  registry.includeProcessor(function () {
    this.handles(() => true);
    this.process(async (_doc, reader, target, attrs) => {
      if (!includeSources) return;
      const { relativePath: from, line } = location(reader.file, reader.lineno - 1);
      const warn = (message: string) => diagnostics.push({ relativePath: from, line, message });
      const relation: Analysis['relations'][number] = { relativePath: from, line, kind: 'include', target, state: 'blocked' };
      semantic.relations.push(relation);
      try {
        if (++count > 64 || reader.includeStack.length >= 16) throw new Error('포함 개수 또는 깊이 한도를 초과했습니다.');
        if (!target || /[\\:\x00-\x1f]/.test(target) || target.startsWith('/') || target.includes('%')) throw new Error('외부·절대 경로 포함은 허용하지 않습니다.');
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
        if (resolved === '..' || resolved.startsWith('../')) throw new Error('작업 공간 밖의 포함을 차단했습니다.');
        if (resolved === from || reader.includeStack.some(entry => location(entry[1], 1).relativePath === resolved)) throw new Error('순환 포함을 차단했습니다.');
        const unsupported = Object.keys(attrs).filter(key => !['tag', 'tags', 'lines', 'leveloffset', 'indent', 'optional-option', 'opts', 'options'].includes(key));
        if (unsupported.length) throw new Error(`지원하지 않는 포함 옵션: ${unsupported.join(', ')}`);
        if (context && !context.sources.has(resolved)) throw new Error(context.includeBlockedMessage ?? '선택 범위 밖의 포함입니다. 사용할 파일을 직접 선택해 주세요.');
        const snapshot = context ? context.sources.get(resolved)! : await workspace.read({ requestId: 'include', workspaceId: session.workspaceId, workspaceEpoch: session.workspaceEpoch, relativePath: resolved });
        bytes += snapshot.byteLength;
        if (bytes > maxBytes) throw new Error('포함 원문의 합계가 4 MiB를 초과했습니다.');
        let lines = snapshot.text.split(/\r\n|\r|\n/).map((text, index) => ({ text, line: index + 1 }));
        if (attrs.lines) {
          const ranges = attrs.lines.split(/[;,]/).map(value => {
            const match = /^(\d+)(?:\.\.(\d+|-1))?$/.exec(value.trim());
            if (!match) throw new Error('지원하지 않는 lines 옵션입니다.');
            return [Number(match[1]), match[2] === '-1' ? lines.length : Number(match[2] ?? match[1])];
          });
          lines = lines.filter(value => ranges.some(([start, end]) => value.line >= start && value.line <= end));
        } else if (attrs.tag || attrs.tags) {
          const tags = (attrs.tag || attrs.tags).split(';');
          if (tags.some(tag => !/^[\w-]+$/.test(tag))) throw new Error('이 단계에서는 이름으로 지정한 tag/tags만 지원합니다.');
          const active = new Map<string, number>(), found = new Set<string>();
          lines = lines.filter(value => {
            const marker = /\b(tag|end)::([\w-]+)\[\]/.exec(value.text);
            if (marker) {
              const depth = active.get(marker[2]) ?? 0;
              if (marker[1] === 'tag') { active.set(marker[2], depth + 1); found.add(marker[2]); }
              else if (depth > 1) active.set(marker[2], depth - 1);
              else active.delete(marker[2]);
              return false;
            }
            return tags.some(tag => active.has(tag));
          });
          if (tags.some(tag => !found.has(tag))) warn('일부 포함 태그를 찾지 못했습니다.');
        }
        const virtualFile = `__metis_include_${count}.adoc`;
        sources.set(virtualFile, { relativePath: resolved, lines: lines.map(value => value.line) });
        relation.state = 'resolved'; relation.destination = { relativePath: resolved, line: lines[0]?.line ?? 1 };
        reader.pushInclude(lines.map(value => value.text), virtualFile, virtualFile, 1, attrs);
      } catch (error) {
        relation.state = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'blocked';
        relation.message = error instanceof Error ? error.message.replaceAll(root, '[작업 공간]') : '포함 실패';
        if ('optional-option' in attrs && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
        warn(error instanceof BoundaryError ? error.message : (error as NodeJS.ErrnoException).code ? '포함 파일을 읽지 못했습니다.' : (error as Error).message);
      }
    });
  });
  const logger = new MemoryLogger();
  LoggerManager.setLogger(logger);
  const doc = await load(text, { safe: 'secure', base_dir: root, sourcemap: true, standalone: false, extension_registry: registry,
    attributes: { docfile: path.join(root, relativePath), docname: path.posix.basename(relativePath, '.adoc'), 'showtitle': '', 'allow-uri-read!': '', 'docinfo!': '' } });
  const outline: OutlineEntry[] = [];
  semantic.finishParse();
  const visit = (node: AbstractBlock) => {
    for (const section of node.getSections()) {
      const source = sourceCursor(section.getSourceLocation());
      outline.push({ id: section.getId() ?? '', title: section.getTitle() ?? '', level: section.getLevel() ?? 1,
        ...location(source.file, source.line) });
      visit(section);
    }
  };
  visit(doc);
  if (context) {
    const collect = (parent: AbstractBlock, parentIndex: number | null = null) => {
      for (const node of parent.getBlocks()) {
        if (context.blocks.length >= 2000) throw new BoundaryError('TOO_LARGE', '문서 맥락의 블록 2,000개 한도를 초과했습니다.');
        const cursor = sourceCursor(node.getSourceLocation());
        const raw = node as AbstractBlock & { getSource?: () => string };
        const index = context.blocks.length;
        const blockText = raw.getSource?.() ?? '';
        context.blocks.push({ ...semantic.blockSource(location(cursor.file, cursor.line), blockText), parent: parentIndex, kind: node.getContext(), title: node.getTitle() ?? '', text: blockText });
        collect(node, index);
      }
    };
    collect(doc);
  }
  const html = String(await doc.convert());
  if (Buffer.byteLength(html) > maxBytes) throw new BoundaryError('TOO_LARGE', '미리보기 출력 한도를 초과했습니다.');
  for (const message of logger.getMessages().slice(0, 100)) {
    const source = sourceCursor(message.getSourceLocation());
    diagnostics.push({ ...location(source.file, source.line), message: message.getText().replaceAll(root, '[작업 공간]') });
  }
  const anchors = semantic.anchors(doc);
  const targetAnchors: Analysis['targetAnchors'] = [];
  for (const use of semantic.attributeUses) if (use.value === undefined) diagnostics.push({ ...use, message: `정의되지 않은 속성: ${use.name}` });
  const metadataLimit = 2000;
  if ([anchors, outline, semantic.relations, semantic.attributes, semantic.attributeUses, semantic.conditions].some(items => items.length > metadataLimit)) {
    diagnostics.unshift({ relativePath, line: 1, message: '탐색 항목별 2,000개 한도: 일부 결과를 표시하지 않습니다.' });
  }
  semantic.relations.splice(metadataLimit);
  const files: string[] = [];
  if (resolveReferences) {
    const queue = ['']; let directories = 0;
    while (queue.length && directories++ < 128 && files.length < 500) {
      try {
        const entries = await workspace.list({ requestId: 'candidates', ...session, relativePath: queue.shift()! });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          if (entry.kind === 'directory') queue.push(entry.relativePath);
          else if (files.length < 500) files.push(entry.relativePath);
        }
      } catch { diagnostics.push({ relativePath, line: 1, message: '일부 폴더의 자동완성 후보를 읽지 못했습니다.' }); }
    }
    if (queue.length || files.length >= 500) diagnostics.push({ relativePath, line: 1, message: '파일 후보 한도(128개 폴더, 500개 문서)에 도달했습니다.' });
    const targets = new Map<string, Analysis>();
    const attempted = new Set<string>();
    let referenceBytes = 0;
    for (const relation of semantic.relations.filter(r => r.kind === 'xref')) {
      if (relation.sourceUncertain) { diagnostics.push({ ...relation, message: relation.message! }); continue; }
      try {
        const target = relation.target;
        if (/[\\:\x00-\x1f%]/.test(target) || target.startsWith('/')) throw new Error('외부·절대 경로 참조를 차단했습니다.');
        const hash = target.indexOf('#');
        const file = hash >= 0 ? target.slice(0, hash) : /\.adoc$/i.test(target) ? target : '';
        const id = hash >= 0 ? target.slice(hash + 1) : file ? '' : target;
        const resolved = file ? path.posix.normalize(path.posix.join(path.posix.dirname(relation.relativePath), file)) : relativePath;
        if (resolved === '..' || resolved.startsWith('../')) throw new Error('작업 공간 밖의 참조를 차단했습니다.');
        let candidates = anchors;
        if (resolved !== relativePath) {
          if (!targets.has(resolved)) {
            if (attempted.size >= 16 || referenceBytes >= maxBytes) { relation.message = '참조 문서 해석 한도(16개, 원문 합계 4 MiB)'; diagnostics.push({ ...relation, message: relation.message }); continue; }
            attempted.add(resolved);
            const snapshot = await workspace.read({ requestId: 'xref', ...session, relativePath: resolved });
            referenceBytes += snapshot.byteLength;
            if (referenceBytes > maxBytes) { relation.message = '참조 원문 합계 4 MiB 초과'; diagnostics.push({ ...relation, message: relation.message }); continue; }
            targets.set(resolved, await analyze(root, resolved, snapshot.text, false));
            targetAnchors.push(...targets.get(resolved)!.anchors.map(anchor => ({ ...anchor, documentPath: resolved })));
          }
          candidates = targets.get(resolved)!.anchors;
        }
        const anchor = candidates.find(anchor => anchor.id === id);
        relation.state = !id || anchor ? 'resolved' : 'missing';
        if (relation.state === 'resolved') relation.destination = anchor ?? { relativePath: resolved, line: 1 };
        else relation.message = `앵커를 찾지 못했습니다: ${id}`;
      } catch (error) {
        relation.state = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'blocked';
        relation.message = error instanceof BoundaryError ? error.message : (error as NodeJS.ErrnoException).code ? '참조 파일을 읽지 못했습니다.' : (error as Error).message;
      }
      if (relation.state !== 'resolved') diagnostics.push({ ...relation, message: relation.message ?? `깨진 참조: ${relation.target}` });
    }
  }
  if (targetAnchors.length > metadataLimit) diagnostics.unshift({ relativePath, line: 1, message: '외부 문서 앵커 후보 2,000개 한도에 도달했습니다.' });
  return { title: doc.getTitle() ?? '', html, outline: outline.slice(0, metadataLimit), diagnostics: diagnostics.slice(0, 100), anchors: anchors.slice(0, metadataLimit), targetAnchors: targetAnchors.slice(0, metadataLimit), files, relations: semantic.relations,
    attributes: semantic.attributes.slice(0, metadataLimit), attributeUses: semantic.attributeUses.slice(0, metadataLimit), conditions: semantic.conditions.slice(0, metadataLimit) };
}
