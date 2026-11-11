import type { ScopedRequest } from './index';
export type D2ExportFormat = 'svg' | 'png' | 'pdf' | 'gif' | 'txt';
export interface D2ExportRequest extends ScopedRequest {
  format: D2ExportFormat;
  name: string;
  frames: string[];
  interval?: number;
}
export function validD2Export(value: Record<string, unknown>): boolean {
  return ['svg', 'png', 'pdf', 'gif', 'txt'].includes(String(value.format))
    && typeof value.name === 'string' && /^[\w.-]{1,120}$/.test(value.name) && !value.name.startsWith('.')
    && Array.isArray(value.frames) && value.frames.length > 0 && value.frames.length <= (value.format === 'gif' ? 100 : 1)
    && value.frames.every(frame => typeof frame === 'string' && frame.length <= 4 * 1024 * 1024 && (value.format === 'txt' || /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/.test(frame)))
    && value.frames.reduce((size, frame) => size + frame.length, 0) <= 32 * 1024 * 1024
    && (value.interval === undefined || Number.isInteger(value.interval) && Number(value.interval) >= 100 && Number(value.interval) <= 60000);
}
