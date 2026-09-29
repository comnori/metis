import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { Analysis } from '@metis/contracts';
export function relativeTarget(from: string, to: string) {
  const base = from.split('/').slice(0, -1), target = to.split('/');
  while (base.length && target.length && base[0] === target[0]) { base.shift(); target.shift(); }
  return [...base.map(() => '..'), ...target].join('/');
}
export function complete(context: CompletionContext, path: string, analysis?: Analysis): CompletionResult | null {
  if (!analysis) return null;
  const line = context.state.doc.lineAt(context.pos), before = line.text.slice(0, context.pos - line.from);
  const after = line.text.slice(context.pos - line.from);
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
