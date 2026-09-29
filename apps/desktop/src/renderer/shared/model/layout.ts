import { useEffect, useState } from 'react';

export type LeftPanel = 'files' | 'search' | 'favorites';
export type RightPanel = 'outline' | 'relations' | 'diagnostics';
export interface WorkspaceLayoutV2 {
  version: 2;
  left: { open: boolean; active: LeftPanel; width: number };
  right: { open: boolean; active: RightPanel; width: number };
}

export const defaultLayout: WorkspaceLayoutV2 = { version: 2, left: { open: true, active: 'files', width: 240 }, right: { open: false, active: 'outline', width: 280 } };
const leftPanels = new Set<LeftPanel>(['files', 'search', 'favorites']);
const rightPanels = new Set<RightPanel>(['outline', 'relations', 'diagnostics']);
export const clampLeft = (value: number) => Math.max(180, Math.min(420, Math.round(value)));
export const clampRight = (value: number) => Math.max(220, Math.min(420, Math.round(value)));

export function readLayout(raw: string | null, legacyRaw?: string | null): WorkspaceLayoutV2 {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (value?.version === 2 && typeof value.left?.open === 'boolean' && leftPanels.has(value.left.active) && Number.isFinite(value.left.width)
      && typeof value.right?.open === 'boolean' && rightPanels.has(value.right.active) && Number.isFinite(value.right.width)) return {
        version: 2, left: { ...value.left, width: clampLeft(value.left.width) }, right: { ...value.right, width: clampRight(value.right.width) }
      };
  } catch { /* migrate or default */ }
  try {
    const legacy = JSON.parse(legacyRaw ?? 'null');
    if (legacy && typeof legacy.files === 'boolean' && typeof legacy.outline === 'boolean') return {
      version: 2,
      left: { open: legacy.files, active: 'files', width: clampLeft(Number(legacy.fileWidth) || defaultLayout.left.width) },
      right: { open: legacy.outline, active: 'outline', width: clampRight(Number(legacy.outlineWidth) || defaultLayout.right.width) }
    };
  } catch { /* default */ }
  return structuredClone(defaultLayout);
}

export function useLayout(workspaceKey?: string) {
  const suffix = workspaceKey ?? 'window', key = `metis.layout.v2.${suffix}`, legacyKey = `metis.layout.v1.${suffix}`;
  const load = () => { try { return readLayout(localStorage.getItem(key), localStorage.getItem(legacyKey)); } catch { return structuredClone(defaultLayout); } };
  const [stored, setStored] = useState(() => ({ key, value: load() }));
  const value = stored.key === key ? stored.value : load();
  const [warning, setWarning] = useState('');
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 900px)').matches);
  const [mobile, setMobile] = useState<'left' | 'right'>();
  useEffect(() => { const next = load(); setStored({ key, value: next }); setMobile(undefined); setWarning(''); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* report on user change */ } }, [key]);
  useEffect(() => { const mq = matchMedia('(max-width: 900px)'); const change = () => { setNarrow(mq.matches); setMobile(undefined); }; mq.addEventListener('change', change); return () => mq.removeEventListener('change', change); }, []);
  function update(next: WorkspaceLayoutV2) {
    const normalized = { version: 2 as const, left: { ...next.left, width: clampLeft(next.left.width) }, right: { ...next.right, width: clampRight(next.right.width) } };
    setStored({ key, value: normalized });
    try { localStorage.setItem(key, JSON.stringify(normalized)); setWarning(''); } catch { setWarning('보기 설정을 저장하지 못했습니다. 현재 창에만 적용됩니다.'); }
  }
  function activateLeft(active: LeftPanel) {
    if (narrow) { setMobile(mobile === 'left' && value.left.active === active ? undefined : 'left'); update({ ...value, left: { ...value.left, active } }); }
    else update({ ...value, left: { ...value.left, active, open: value.left.active === active ? !value.left.open : true } });
  }
  function activateRight(active: RightPanel) {
    if (narrow) { setMobile(mobile === 'right' && value.right.active === active ? undefined : 'right'); update({ ...value, right: { ...value.right, active } }); }
    else update({ ...value, right: { ...value.right, active, open: value.right.active === active ? !value.right.open : true } });
  }
  return { value, narrow, mobile, setMobile, warning, update, activateLeft, activateRight,
    resizeLeft: (width: number) => update({ ...value, left: { ...value.left, width } }), resizeRight: (width: number) => update({ ...value, right: { ...value.right, width } }),
    reset: () => { update(structuredClone(defaultLayout)); setMobile(undefined); } };
}
