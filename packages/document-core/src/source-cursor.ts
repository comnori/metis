// Table cells in Asciidoctor 4 can expose a plain cursor copy rather than
// a Cursor instance. Normalize both forms at the parser boundary.
export function sourceCursor(value: unknown): { file: string | undefined; line: number } {
  const cursor = value as { getFile?: () => unknown; getLineNumber?: () => unknown; file?: unknown; lineno?: unknown } | null | undefined;
  const file = typeof cursor?.getFile === 'function' ? cursor.getFile() : cursor?.file;
  const line = typeof cursor?.getLineNumber === 'function' ? cursor.getLineNumber() : cursor?.lineno;
  return { file: typeof file === 'string' ? file : undefined, line: typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : 1 };
}
