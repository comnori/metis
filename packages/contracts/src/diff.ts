// Bounded, deterministic replacement hunk. It deliberately does not compute a quadratic LCS.
export function textDiff(before: string | undefined, after: string | undefined): string {
  if (before === undefined && after === undefined) return '양쪽에 내용이 없습니다.';
  const normalize = (value: string | undefined) => value?.replace(/\r\n|\r/g, '\n');
  if (normalize(before) === normalize(after)) return '텍스트 차이가 없습니다. 줄바꿈·BOM 차이는 표시하지 않습니다.';
  const a = before === undefined ? [] : normalize(before)!.split('\n'), b = after === undefined ? [] : normalize(after)!.split('\n');
  let start = 0, end = 0;
  while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
  while (end < Math.min(a.length, b.length) - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
  const lines = [`@@ -${start + 1},${a.length - start - end} +${start + 1},${b.length - start - end} @@`];
  for (const line of a.slice(Math.max(0, start - 3), start)) lines.push(` ${line.slice(0, 1000)}`);
  const removed = a.slice(start, a.length - end), added = b.slice(start, b.length - end);
  for (const line of removed.slice(0, 150)) lines.push(`- ${line.slice(0, 1000)}`);
  if (removed.length > 150) lines.push('… 삭제 구간 150줄 이후 생략');
  for (const line of added.slice(0, 150)) lines.push(`+ ${line.slice(0, 1000)}`);
  if (added.length > 150) lines.push('… 추가 구간 150줄 이후 생략');
  for (const line of b.slice(b.length - end, b.length - end + Math.min(end, 3))) lines.push(` ${line.slice(0, 1000)}`);
  return lines.join('\n');
}
