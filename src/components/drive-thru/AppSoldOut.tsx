'use client';
// src/components/drive-thru/AppSoldOut.tsx — SOLD OUT ON THE APPS TOO, on the counter page (lib/app-orders appSoldOutTodo;
// design board "Sold out on the apps too"). Guests on a delivery app can't see what's sold out here, so each item sold
// out here is to be marked sold out on each app, and each one back here turned back on there. Each app is ticked once
// (api/counter 'appSoldOut'); the reminder goes once every app is done.

const MUTED = '#6d7075', LINE = '#ececee', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-3 text-[14px] font-semibold disabled:opacity-40 ${RING}`;

export type AppSoldOutRow = { id: string; name: string; out: boolean; at: string | null; apps: { code: string; label: string }[] };

export function AppSoldOut({ rows, taps, busy, act, notify }: { rows: AppSoldOutRow[]; taps?: number; busy: string | null; act: (label: string, body: any, after?: (d: any) => void) => void; notify?: (text: string) => void }) {
  if (!rows.length) return null;
  const shown = rows.reduce((n, r) => n + r.apps.length, 0); const todo = Math.max(shown, taps || 0);
  return (
    <section aria-labelledby="app-soldout-h" className="space-y-3 rounded-3xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="app-soldout-h" className="text-[17px] font-semibold">On the delivery apps</h2>
        <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>{todo} to do</span>
      </div>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {rows.map((r) => (
          <li key={r.id} className="space-y-2">
            <p className="text-[14.5px]"><span className="font-semibold">{r.name}</span> <span style={{ color: MUTED }}>{r.out ? 'is sold out here' : 'is back'}</span></p>
            <div className="flex flex-wrap gap-2">
              {r.apps.map((a) => (
                <button key={a.code} type="button" disabled={!!busy} className={`${btn} w-full sm:w-auto sm:flex-1`} style={{ background: '#fff', border: `1px solid ${LINE}` }}
                  onClick={() => act(`appout-${r.id}-${a.code}`, { action: 'appSoldOut', itemId: r.id, app: a.code, out: r.out }, () => notify?.(`${r.name}: ${r.out ? 'sold out' : 'back on'} on ${a.label}.`))}>
                  {r.out ? `Sold out on ${a.label}` : `Back on, on ${a.label}`}</button>))}
            </div>
          </li>))}
      </ul>
      {todo > shown && <p className="text-[13.5px]" style={{ color: AMBER }}>And {todo - shown} more after these.</p>}
      <p className="text-[12.5px]" style={{ color: MUTED }}>Guests on the apps can’t see what’s sold out here. Tap each one once you’ve done it in that app.</p>
    </section>);
}
