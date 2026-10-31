/** FLOOR (black) / BAR (red) tag used wherever an event row is listed (push 25a). */
export function DeptTag({ dept }: { dept: string }) {
  const bar = dept === 'bar';
  return <span className={'dept-tag' + (bar ? ' bar' : '')}>{bar ? 'BAR' : 'FLOOR'}</span>;
}
