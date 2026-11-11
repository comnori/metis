import type { PathRequest } from './index';
export type AttachmentKind = 'image' | 'audio' | 'video' | 'file';
export interface AttachmentSource { path?: string; png?: number[] }
export interface AttachmentRequest extends PathRequest {
  action: 'import' | 'register' | 'release' | 'open';
  sources?: AttachmentSource[];
  targets?: string[];
  group?: string;
  token?: string;
  reveal?: boolean;
}
export interface AttachmentFile { relativePath: string; kind: AttachmentKind }
export interface AttachmentResource { target: string; url?: string; token?: string; kind?: AttachmentKind; error?: string }
export interface AttachmentResult { files: AttachmentFile[]; errors: string[]; resources: AttachmentResource[]; group?: string }
export function validAttachmentRequest(value: Record<string, unknown>): boolean {
  const action = value.action;
  if (!['import', 'register', 'release', 'open'].includes(String(action))) return false;
  const extra = action === 'import' ? ['sources'] : action === 'register' ? ['targets'] : action === 'release' ? ['group'] : ['token', 'reveal'];
  if (Object.keys(value).some(k => !['requestId', 'workspaceId', 'workspaceEpoch', 'relativePath', 'action', ...extra].includes(k))) return false;
  if (typeof value.relativePath !== 'string' || !/\.adoc$/i.test(value.relativePath)) return false;
  if (action === 'import') return value.sources === undefined || (Array.isArray(value.sources) && value.sources.length <= 50 && value.sources.every(s => {
    if (!s || typeof s !== 'object') return false;
    const keys = Object.keys(s);
    return keys.length === 1 && ((keys[0] === 'path' && typeof s.path === 'string' && s.path.length <= 4096 && !s.path.includes('\0')) || (keys[0] === 'png' && Array.isArray(s.png) && s.png.length <= 32 * 1024 * 1024 && s.png.every((b: unknown) => Number.isInteger(b) && Number(b) >= 0 && Number(b) <= 255)));
  }));
  if (action === 'register') return Array.isArray(value.targets) && value.targets.length <= 1000 && value.targets.every(t => typeof t === 'string' && t.length <= 4096);
  if (action === 'release') return typeof value.group === 'string' && /^[\w-]{1,80}$/.test(value.group);
  return typeof value.token === 'string' && /^[\w-]{1,80}$/.test(value.token) && typeof value.reveal === 'boolean';
}
