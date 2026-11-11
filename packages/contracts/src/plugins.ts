import type { ScopedRequest } from './index';

export const pluginSdkVersion = 1;
export interface PluginManifest {
  id: string; name: string; version: string; description: string; author: string;
  minAppVersion: string; sdkVersion: number;
}
export interface PluginRecord extends PluginManifest {
  enabled: boolean; source?: string; error?: string; entryUrl: string; styleUrl?: string;
}
export type PluginOperation = 'list' | 'install' | 'github' | 'enable' | 'remove' | 'call' | 'cancel';
export interface PluginRequest extends ScopedRequest {
  operation: PluginOperation; pluginId?: string; payload?: unknown;
}
export type PluginAction = 'http' | 'download' | 'read' | 'write' | 'settings.get' | 'settings.set' |
  'openExternal' | 'auth.pat' | 'auth.configure' | 'auth.start' | 'auth.status' | 'auth.disconnect';
export interface PluginFile { text: string; hash: string }
export interface PluginHttpResult { status: number; headers: Record<string, string>; body: string }
export interface PluginAuthStatus { configured: boolean; connected: boolean; persistent: boolean; mode?: 'pat' | 'oauth'; clientId?: string; redirectUri?: string; workspaceName?: string; workspaceId?: string }
export interface PluginPatConfig { provider: 'notion'; token: string }
export interface PluginOAuthConfig { clientId: string; clientSecret?: string; redirectUri: string; authorizeUrl: string; tokenUrl: string; apiOrigin: string }
export interface PluginApi {
  readonly sdkVersion: 1;
  command(id: string, title: string, run: () => void): void;
  panel(id: string, title: string, mount: (root: HTMLElement, signal: AbortSignal) => void | (() => void)): void;
  openPanel(id: string): void;
  closePanel(): void;
  request<T>(action: PluginAction, payload?: unknown, signal?: AbortSignal): Promise<T>;
  isDirty(relativePath: string): boolean;
  filesChanged(paths: string[]): void;
}
export function validPluginManifest(value: unknown): value is PluginManifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as PluginManifest;
  return /^[a-z][a-z0-9-]{0,50}$/.test(m.id) && ['name', 'description', 'author'].every(k => typeof (m as unknown as Record<string, unknown>)[k] === 'string' && String((m as unknown as Record<string, unknown>)[k]).length <= 500) &&
    !!m.name && /^\d+\.\d+\.\d+$/.test(m.version) && /^\d+\.\d+\.\d+$/.test(m.minAppVersion) && m.sdkVersion === pluginSdkVersion;
}
export function validPluginRequest(v: unknown): v is PluginRequest {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as PluginRequest;
  return Object.keys(r).every(k => ['requestId', 'workspaceId', 'workspaceEpoch', 'operation', 'pluginId', 'payload'].includes(k)) &&
    typeof r.requestId === 'string' && /^[\w-]{1,80}$/.test(r.requestId) && typeof r.workspaceId === 'string' && /^[\w-]{1,80}$/.test(r.workspaceId) && Number.isSafeInteger(r.workspaceEpoch) && r.workspaceEpoch > 0 &&
    ['list', 'install', 'github', 'enable', 'remove', 'call', 'cancel'].includes(r.operation) && (r.pluginId === undefined || /^[a-z][a-z0-9-]{0,50}$/.test(r.pluginId));
}
