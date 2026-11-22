import type { AttachmentKind, AttachmentSource } from '@metis/contracts';
function normalize(parts: string[]): string[] {
  const output: string[] = [];
  for (const part of parts) { if (!part || part === '.') continue; if (part === '..') { if (!output.length) throw new Error('imagesdir가 작업 공간 밖을 가리킵니다.'); output.pop(); } else output.push(part); }
  return output;
}
export function attachmentMacro(document: string, file: { relativePath: string; kind: AttachmentKind }, imagesdir = ''): string {
  let base = document.split('/').slice(0, -1);
  if (file.kind !== 'file' && imagesdir) {
    if (/^[a-z][\w+.-]*:|^[\/\\]/i.test(imagesdir)) throw new Error('미디어 삽입에는 로컬 상대 imagesdir가 필요합니다. 복사된 첨부파일은 assets에 보존됩니다.');
    base = normalize([...base, ...imagesdir.split('/')]);
  }
  const target = file.relativePath.split('/'); let i = 0;
  while (i < base.length && i < target.length && base[i] === target[i]) i++;
  const relative = [...base.slice(i).map(() => '..'), ...target.slice(i)].map(p => encodeURIComponent(p).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)).join('/');
  const label = file.relativePath.split('/').at(-1)!.replace(/[,=\[\]{}"\r\n]/g, '_');
  return file.kind === 'file' ? `link:${relative}[${label}]` : `${file.kind}::${relative}[${file.kind === 'image' ? label : ''}]`;
}
export async function attachmentSources(files: File[], paste: boolean): Promise<AttachmentSource[]> {
  return Promise.all(files.map(async file => {
    const path = window.metis.attachmentFilePath(file);
    if (path && !paste) return { path };
    if (!file.type.startsWith('image/')) throw new Error('이 입력에서 파일 경로를 확인할 수 없습니다. 파일 선택을 사용하세요.');
    if (file.size > 32 * 1024 * 1024) throw new Error('붙여넣기 이미지는 32 MiB까지 지원합니다.');
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 32 * 1024 * 1024) throw new Error('붙여넣기 이미지 크기를 줄여 주세요.');
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 변환 실패')), 'image/png'));
      if (blob.size > 32 * 1024 * 1024) throw new Error('붙여넣기 PNG는 32 MiB까지 지원합니다.');
      return { png: Array.from(new Uint8Array(await blob.arrayBuffer())) };
    } finally { bitmap.close(); }
  }));
}
