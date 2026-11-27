// Nov 27 · Today: lower sections wait for Tonight so it gets the database first (max 6 s)
let open: (() => void) | null = null;
let gate: Promise<void> = Promise.resolve();
export function holdForTonight() { if (open) return; gate = new Promise<void>((r) => { open = r; setTimeout(() => { open = null; r(); }, 6000); }); }
export function tonightLoaded() { const f = open; open = null; f?.(); }
export const afterTonight = () => gate;
