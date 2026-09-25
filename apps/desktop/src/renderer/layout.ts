import { useEffect, useState } from 'react';
export const defaultLayout = { files: true, outline: true, fileWidth: 240, outlineWidth: 180 };
export function readLayout(raw: string | null) {
  try { const v = JSON.parse(raw ?? 'null');
    if (!v || typeof v.files !== 'boolean' || typeof v.outline !== 'boolean' || !Number.isInteger(v.fileWidth) || v.fileWidth < 180 || v.fileWidth > 360 || !Number.isInteger(v.outlineWidth) || v.outlineWidth < 140 || v.outlineWidth > 300) return { ...defaultLayout };
    return { files: v.files, outline: v.outline, fileWidth: v.fileWidth, outlineWidth: v.outlineWidth };
  } catch { return { ...defaultLayout }; }
}
export function useLayout(workspaceKey?: string) {
  const key = `metis.layout.v1.${workspaceKey ?? 'window'}`;
  const load = () => { try { return readLayout(localStorage.getItem(key)); } catch { return { ...defaultLayout }; } };
  const [stored, setStored] = useState(() => ({ key, value: load() }));
  const value = stored.key === key ? stored.value : load();
  const [warning, setWarning] = useState('');
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 900px)').matches);
  const [mobile, setMobile] = useState<'files' | 'outline'>();
  useEffect(() => { setStored({ key, value: load() }); setMobile(undefined); setWarning(''); }, [key]);
  useEffect(() => { const mq = matchMedia('(max-width: 900px)'); const change = () => { setNarrow(mq.matches); setMobile(undefined); }; mq.addEventListener('change', change); return () => mq.removeEventListener('change', change); }, []);
  function update(next: typeof defaultLayout) { setStored({ key, value: next }); try { localStorage.setItem(key, JSON.stringify(next)); setWarning(''); } catch { setWarning('보기 설정을 저장하지 못했습니다. 현재 창에만 적용됩니다.'); } }
  return { value, narrow, mobile, setMobile, warning, update, reset: () => { update({ ...defaultLayout }); setMobile(undefined); }, toggle: (panel: 'files' | 'outline') => narrow ? setMobile(mobile === panel ? undefined : panel) : update({ ...value, [panel]: !value[panel] }) };
}
