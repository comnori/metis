import type { CompileOptions, D2, Diagram, RenderOptions } from '@d2lang/d2';
import type { D2Board, Diagnostic, ExtensionDefinition, ExtensionPreviewInput, ExtensionPreviewResult } from '@metis/contracts';

// The upstream browser distribution contains its worker and WASM. Keep it as a
// lazy, unmodified build asset rather than parsing/rebundling 35 MB in Vite.
export async function createD2(): Promise<D2> {
  const url = new URL('./d2-engine.js', document.baseURI).href;
  const module = await import(/* @vite-ignore */ url) as typeof import('@d2lang/d2');
  return new module.D2();
}

export function d2Options(attributes: Record<string, string>): CompileOptions {
  const options: CompileOptions = {};
  const bools = { sketch: 'sketch', center: 'center', appendix: 'forceAppendix', ascii: 'ascii' } as const;
  for (const [attr, key] of Object.entries(bools)) if (attributes[attr] !== undefined) {
    if (!['true', 'false'].includes(attributes[attr])) throw Error(`${attr}: true 또는 false를 지정하세요.`);
    options[key] = attributes[attr] === 'true';
  }
  const numbers = { theme: ['themeID', 0, 10000], 'dark-theme': ['darkThemeID', 0, 10000], pad: ['pad', 0, 1000], scale: ['scale', 0.05, 10], 'animate-interval': ['animateInterval', 100, 60000] } as const;
  for (const [attr, [key, min, max]] of Object.entries(numbers)) if (attributes[attr] !== undefined) {
    const n = Number(attributes[attr]);
    if (!attributes[attr].trim() || !Number.isFinite(n) || n < min || n > max || key !== 'scale' && !Number.isInteger(n)) throw Error(`${attr}: ${min}~${max} 범위의 숫자를 지정하세요.`);
    options[key] = n;
  }
  if (attributes.layout !== undefined) {
    if (!['dagre', 'elk', 'tala'].includes(attributes.layout)) throw Error('layout: dagre, elk, tala 중 하나를 지정하세요.');
    options.layout = attributes.layout as CompileOptions['layout'];
  }
  if (attributes['ascii-mode'] !== undefined) {
    if (!['standard', 'extended'].includes(attributes['ascii-mode'])) throw Error('ascii-mode: standard 또는 extended를 지정하세요.');
    options.asciiMode = attributes['ascii-mode'] as CompileOptions['asciiMode'];
  }
  if (attributes.target !== undefined) options.target = attributes.target;
  return options;
}

export function d2Path(from: string, target: string): string {
  if (!target || /[\\:%?#\x00-\x1f]/.test(target) || target.startsWith('/')) throw Error('D2 의존 파일은 작업 공간 내부 상대 경로를 사용하세요.');
  const parts = from.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') { if (!parts.length) throw Error('작업 공간 밖의 D2 의존 파일입니다.'); parts.pop(); }
    else if (part && part !== '.') { if (part.startsWith('.')) throw Error('숨김 경로는 D2 의존 파일로 사용할 수 없습니다.'); parts.push(part); }
  }
  return parts.join('/');
}

function errors(error: unknown): Array<{ range?: string; errmsg: string }> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const parsed: unknown = JSON.parse(message);
    if (Array.isArray(parsed) && parsed.every(e => e && typeof e.errmsg === 'string')) return parsed;
  } catch { /* Plain renderer or file error. */ }
  return [{ errmsg: message }];
}

export function d2Diagnostic(error: unknown, path: string, line: number, inputPath: string): Diagnostic {
  const detail = errors(error)[0];
  const range = /^(.*),(\d+):\d+:\d+-/.exec(detail.range ?? '');
  const sourceLine = range ? Number(range[2]) + (range[1] === inputPath ? line : 1) : line;
  const message = detail.errmsg.replaceAll(inputPath, path);
  const prefix = `${path}:${range ? Number(range[2]) + 1 : 1}:`;
  return { relativePath: range && range[1] !== inputPath ? range[1] : path, line: sourceLine, message: `D2 렌더링 오류: ${range?.[1] === inputPath && message.startsWith(prefix) ? `${path}:${sourceLine}:${message.slice(prefix.length)}` : message}`.slice(0, 10000) };
}

function boards(diagram: Diagram, prefix = ''): Array<{ name: string; diagram: Diagram }> {
  const result = diagram.isFolderOnly ? [] : [{ name: prefix || 'root', diagram }];
  for (const kind of ['layers', 'scenarios', 'steps'] as const) for (const child of diagram[kind] ?? []) {
    if (child) result.push(...boards(child, [prefix, kind, child.name].filter(Boolean).join('.')));
    if (result.length > 100) throw Error('D2 보드는 블록당 100개까지 표시할 수 있습니다.');
  }
  return result;
}

function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}

async function embedImages(diagram: Diagram, path: string, read: (path: string) => Promise<Uint8Array>) {
  const mime: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
  for (const board of boards(diagram)) for (const shape of [board.diagram.root, ...board.diagram.shapes, ...board.diagram.connections]) {
    if (!shape.icon) continue;
    // D2 0.1.34 serializes Go's url.URL, despite declaring icon as string.
    const icon = shape.icon as unknown as string | { Scheme: string; Path: string; Opaque: string };
    if (typeof icon === 'string' ? /^(?:https:\/\/|data:image\/)/i.test(icon) : ['https', 'data'].includes(icon.Scheme)) continue;
    if (typeof icon !== 'string' && icon.Scheme) throw Error('D2 이미지는 로컬 상대 경로, HTTPS 또는 data URL을 사용하세요.');
    const target = d2Path(path, typeof icon === 'string' ? icon : icon.Path), type = mime[target.split('.').pop()!.toLowerCase()];
    if (!type) throw Error(`지원하지 않는 D2 이미지 형식: ${target}`);
    const url = dataUrl(await read(target), type);
    shape.icon = (typeof icon === 'string' ? url : { Scheme: 'data', Opaque: url.slice(5) }) as unknown as string;
  }
}

export async function renderD2Preview(input: ExtensionPreviewInput, signal: AbortSignal, factory = createD2): Promise<ExtensionPreviewResult> {
  const template = document.createElement('template'); template.innerHTML = input.html;
  const blocks = [...template.content.querySelectorAll<HTMLElement>('.metis-d2')];
  const result: ExtensionPreviewResult = { html: input.html, assets: new Map(), diagnostics: [] };
  if (!blocks.length || signal.aborted) return result;
  const engine = await factory();
  const abort = () => { void engine.dispose(); };
  signal.addEventListener('abort', abort, { once: true });
  const files = new Map<string, Promise<Uint8Array>>(); let totalBytes = 0;
  const read = (path: string): Promise<Uint8Array> => {
    if (signal.aborted) return Promise.reject(Error('Cancelled'));
    if (!files.has(path)) {
      if (files.size >= 64) return Promise.reject(Error('D2 의존 파일은 문서당 64개까지 지원합니다.'));
      files.set(path, (async () => {
        if (!input.readD2File) throw Error('D2 의존 파일을 읽을 수 없습니다.');
        const value = await input.readD2File(path);
        totalBytes += value.byteLength;
        if (totalBytes > 32 * 1024 * 1024) throw Error('D2 의존 파일 합계가 32 MiB를 초과했습니다.');
        return value;
      })());
    }
    return files.get(path)!;
  };
  try {
    for (const [index, block] of blocks.entries()) {
      if (signal.aborted) break;
      const path = block.dataset.d2Path ?? '', line = Math.max(1, Number(block.dataset.d2Line) || 1);
      const inputPath = d2Path(path, `__metis_d2_${index}.d2`);
      try {
        const attributes = JSON.parse(block.dataset.d2Options ?? '{}') as Record<string, string>;
        const options = d2Options(attributes);
        for (const [attr, key] of [['font-regular', 'fontRegular'], ['font-bold', 'fontBold'], ['font-italic', 'fontItalic'], ['font-semibold', 'fontSemibold']] as const) {
          // The WASM bridge JSON-encodes options; Go []byte accepts base64,
          // whereas JSON.stringify(Uint8Array) produces an incompatible object.
          if (attributes[attr]) options[key] = dataUrl(await read(d2Path(path, attributes[attr])), 'font/ttf').split(',')[1] as unknown as Uint8Array;
        }
        const fs: Record<string, string> = Object.create(null);
        fs[inputPath] = block.querySelector('pre code')?.textContent ?? '';
        let compiled;
        // Let the official parser resolve imports, including quoted paths, globs,
        // spreads and nested imports. Supply only files it actually requests.
        for (let attempt = 0; ; attempt++) {
          if (signal.aborted) throw Error('Cancelled');
          try { compiled = await engine.compile({ fs, inputPath, options }); break; }
          catch (error) {
            const missing = [...new Set(errors(error).flatMap(e => [...e.errmsg.matchAll(/failed to import "([^"]+\.d2)": file does not exist/g)].map(m => m[1])))];
            if (!missing.length || attempt >= 64) throw error;
            for (const name of missing) {
              const canonical = d2Path('', name);
              if (Object.hasOwn(fs, canonical)) throw error;
              fs[canonical] = new TextDecoder('utf-8', { fatal: true }).decode(await read(canonical));
            }
          }
        }
        await embedImages(compiled.diagram, path, read);
        const renderOptions: RenderOptions = { ...compiled.renderOptions, ...options, noXMLTag: true, salt: `metis-d2-${index}` };
        if (renderOptions.scale == null) renderOptions.scale = 1;
        // Explicit source/block themes take precedence over the application theme.
        if (input.theme === 'dark' && attributes.theme === undefined && (renderOptions.themeID == null || renderOptions.themeID === 0) && !/(?:^|[\s{;])theme-id\s*:/.test(Object.values(fs).join('\n'))) renderOptions.themeID = renderOptions.darkThemeID ?? 200;
        const rendered: D2Board[] = [];
        if (renderOptions.target !== undefined && renderOptions.target !== null || renderOptions.animateInterval) {
          if (renderOptions.animateInterval && !renderOptions.target) renderOptions.target = '*';
          const output = await engine.render(compiled.diagram, renderOptions);
          rendered.push(renderOptions.ascii ? { name: renderOptions.target || 'root', svg: '', ascii: output } : { name: renderOptions.animateInterval ? 'animation' : renderOptions.target || 'root', svg: output });
        } else {
          for (const [boardIndex, board] of boards(compiled.diagram).entries()) {
            if (signal.aborted) throw Error('Cancelled');
            const output = await engine.render(board.diagram, { ...renderOptions, target: undefined, salt: `metis-d2-${index}-${boardIndex}` });
            rendered.push(renderOptions.ascii ? { name: board.name, svg: '', ascii: output } : { name: board.name, svg: output });
          }
        }
        if (!rendered.length) throw Error('표시할 D2 보드가 없습니다.');
        if (rendered.some(b => b.svg.length > 4 * 1024 * 1024 || (b.ascii?.length ?? 0) > 1024 * 1024) || rendered.reduce((n, b) => n + b.svg.length + (b.ascii?.length ?? 0), 0) > 16 * 1024 * 1024) throw Error('D2 출력 한도를 초과했습니다. 보드를 나누거나 target을 지정하세요.');
        const token = `d2-${index}`;
        result.assets.set(token, { kind: 'd2', boards: rendered });
        block.querySelector('pre')?.remove();
        const slot = document.createElement('div'); slot.className = 'metis-d2-output'; slot.dataset.previewAsset = token; block.append(slot);
      } catch (error) {
        if (signal.aborted) break;
        const diagnostic = d2Diagnostic(error, path, line, inputPath);
        result.diagnostics.push(diagnostic); block.classList.add('metis-d2-error');
        const notice = document.createElement('p'); notice.textContent = diagnostic.message; block.querySelector('pre')?.before(notice);
      }
    }
    result.html = template.innerHTML;
    return result;
  } finally { signal.removeEventListener('abort', abort); await engine.dispose(); }
}

export const d2Extension: ExtensionDefinition = {
  id: 'd2', name: 'D2 다이어그램', defaultEnabled: true,
  description: '[d2] 블록의 레이아웃·테마·스케치·수식·이미지·다중 보드를 표시합니다. 비활성화하면 원문 코드를 표시합니다.',
  activate(api) { api.preview('diagrams', renderD2Preview); }
};
