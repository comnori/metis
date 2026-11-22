/** Browser navigation is explicit and limited to ordinary web URLs. */
export function validWebLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192 || !/^https?:\/\//i.test(value) || /[\s\x00-\x1f\\]/.test(value) || !value.isWellFormed()) return false;
  try { const url = new URL(value); return !!url.hostname && !url.username && !url.password; } catch { return false; }
}
