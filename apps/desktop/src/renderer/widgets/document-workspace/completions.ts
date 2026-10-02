import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { Analysis } from '@metis/contracts';
export function relativeTarget(from: string, to: string) {
  const base = from.split('/').slice(0, -1), target = to.split('/');
  while (base.length && target.length && base[0] === target[0]) { base.shift(); target.shift(); }
  return [...base.map(() => '..'), ...target].join('/');
}
export function complete(context: CompletionContext, path: string, analysis?: Analysis): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos), before = line.text.slice(0, context.pos - line.from);
  const after = line.text.slice(context.pos - line.from);

  const slashMatch = /(?:^|\s)\/([a-zA-Z0-9-]*)$/.exec(before);
  if (slashMatch) {
    const slashWord = slashMatch[1];
    const slashFrom = context.pos - slashWord.length - 1;
    const slashOptions = [
      { label: '/note', apply: '[NOTE]\n====\n\n====\n', detail: '참고 경고문 (Note admonition)', type: 'keyword' },
      { label: '/tip', apply: '[TIP]\n====\n\n====\n', detail: '팁 블록 (Tip admonition)', type: 'keyword' },
      { label: '/warning', apply: '[WARNING]\n====\n\n====\n', detail: '경고 블록 (Warning admonition)', type: 'keyword' },
      { label: '/important', apply: '[IMPORTANT]\n====\n\n====\n', detail: '중요 블록 (Important admonition)', type: 'keyword' },
      { label: '/caution', apply: '[CAUTION]\n====\n\n====\n', detail: '주의 블록 (Caution admonition)', type: 'keyword' },
      { label: '/code', apply: '[source]\n----\n\n----\n', detail: '소스 코드 블록 (Source code block)', type: 'keyword' },
      { label: '/table', apply: '|===\n| 열 1 | 열 2\n\n| 항목 1 | 항목 2\n|===\n', detail: 'AsciiDoc 표 (Table)', type: 'keyword' },
      { label: '/mermaid', apply: '[mermaid]\n----\nflowchart TD\n    A[시작] --> B[완료]\n----\n', detail: 'Mermaid 다이어그램 블록', type: 'keyword' },
      { label: '/quote', apply: '[quote]\n____\n\n____\n', detail: '인용 블록 (Quote block)', type: 'keyword' },
      { label: '/sidebar', apply: '****\n\n****\n', detail: '사이드바 블록 (Sidebar block)', type: 'keyword' },
      { label: '/example', apply: '====\n\n====\n', detail: '예제 블록 (Example block)', type: 'keyword' },
      { label: '/todo', apply: '* [ ] ', detail: '체크리스트 할 일 (Task checklist)', type: 'keyword' },
      { label: '/h1', apply: '= ', detail: '문서 제목 / 레벨 1 제목', type: 'keyword' },
      { label: '/h2', apply: '== ', detail: '섹션 제목 / 레벨 2 제목', type: 'keyword' },
      { label: '/h3', apply: '=== ', detail: '소제목 / 레벨 3 제목', type: 'keyword' },
      { label: '/include', apply: 'include::[]', detail: '문서 포함 지시자 (Include)', type: 'keyword' },
      { label: '/xref', apply: 'xref:[]', detail: '문서 상호 참조 (Cross reference)', type: 'keyword' }
    ];
    return { from: slashFrom, options: slashOptions, validFor: /^\/[a-zA-Z0-9-]*$/ };
  }

  if (!analysis) return null;
  const macro = /(include::|xref:)([^\s\[]*)$/.exec(before), short = /<<([^>,]*)$/.exec(before), attr = /(?<!\\)\{([\w-]*)$/.exec(before);
  if (!macro && !short && !attr) return null;
  const prefix = attr?.[1] ?? macro?.[2] ?? short![1];
  const suffix = attr ? after.startsWith('}') ? '' : '}' : macro ? after.startsWith('[') ? '' : '[]' : after.startsWith('>>') ? '' : '>>';
  const options: Array<{ label: string; apply: string; detail: string; type: string }> = [];
  if (attr) {
    const values = new Map(analysis.attributes.filter(a => a.applied && (a.relativePath !== path || a.line <= line.number)).map(a => [a.name, a]));
    for (const [name, value] of values) if (value.value !== '(해제)') options.push({ label: name, apply: name + suffix, detail: `${value.value} · ${value.relativePath}:${value.line}`, type: 'variable' });
  } else {
    if (macro) for (const file of analysis.files) if (file !== path) {
      const label = relativeTarget(path, file); options.push({ label, apply: label + suffix, detail: file, type: 'file' });
    }
    if (!macro || macro[1] === 'xref:') {
      for (const anchor of analysis.anchors) options.push({ label: anchor.id, apply: anchor.id + suffix, detail: `${anchor.relativePath}:${anchor.line}`, type: 'reference' });
      if (macro) for (const anchor of analysis.targetAnchors) {
        const label = `${relativeTarget(path, anchor.documentPath)}#${anchor.id}`;
        options.push({ label, apply: label + suffix, detail: `${anchor.relativePath}:${anchor.line}`, type: 'reference' });
      }
    }
  }
  return { from: context.pos - prefix.length, options, validFor: /^[\w./#-]*$/ };
}
