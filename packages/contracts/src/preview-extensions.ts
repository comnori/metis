import type { Diagnostic } from './index';

export interface D2Board { name: string; svg: string; ascii?: string }
export type PreviewAsset = { kind: 'svg'; svg: string } | { kind: 'd2'; boards: D2Board[] } | {
  kind: 'youtube'; videoId: string; start?: number; end?: number; width?: number; height?: number;
};
export interface ExtensionPreviewInput {
  html: string; theme: 'default' | 'dark' | 'sepia';
  readD2File?(relativePath: string): Promise<Uint8Array>;
}
export interface ExtensionPreviewResult { html: string; assets: Map<string, PreviewAsset>; diagnostics: Diagnostic[] }
export type ExtensionPreviewRenderer = (input: ExtensionPreviewInput, signal: AbortSignal) => Promise<ExtensionPreviewResult>;

export function validPreviewResult(value: ExtensionPreviewResult): boolean {
  return !!value && typeof value.html === 'string' && value.html.length <= 16 * 1024 * 1024
    && value.assets instanceof Map && value.assets.size <= 200
    && [...value.assets].every(([key, asset]) => typeof key === 'string' && key.length <= 150 && !!asset && (
      asset.kind === 'svg' ? typeof asset.svg === 'string' && asset.svg.length <= 4 * 1024 * 1024
        : asset.kind === 'd2' ? Array.isArray(asset.boards) && asset.boards.length > 0 && asset.boards.length <= 100
          && asset.boards.every(board => !!board && typeof board.name === 'string' && board.name.length <= 1000 && typeof board.svg === 'string' && board.svg.length <= 4 * 1024 * 1024 && (board.ascii === undefined || typeof board.ascii === 'string' && board.ascii.length <= 1024 * 1024))
          && asset.boards.reduce((size, board) => size + board.svg.length + (board.ascii?.length ?? 0), 0) <= 16 * 1024 * 1024
        : asset.kind === 'youtube' && typeof asset.videoId === 'string' && /^[\w-]{11}$/.test(asset.videoId)
          && [asset.start, asset.end, asset.width, asset.height].every(n => n === undefined || (Number.isSafeInteger(n) && n >= 0 && n <= 86400))))
    && Array.isArray(value.diagnostics) && value.diagnostics.length <= 500
    && value.diagnostics.every(d => d && typeof d.message === 'string' && d.message.length <= 10000 && typeof d.relativePath === 'string' && Number.isSafeInteger(d.line) && d.line > 0);
}
