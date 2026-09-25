'use client';
// src/components/hq/hq.tsx — shared pieces for the ClarityFlow HQ screens.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getAuth } from 'firebase/auth';

export async function hq(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/hq', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}

export const HEALTH_TONE: Record<string, string> = {
  thriving: 'bg-emerald-600 text-white', healthy: 'bg-emerald-100 text-emerald-800', watch: 'bg-amber-100 text-amber-800', 'at risk': 'bg-red-100 text-red-700', new: 'bg-sky-100 text-sky-800',
};
export const ago = (iso?: string | null) => {
  if (!iso) return '—';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

export function HqNav() {
  const path = usePathname() || '';
  const tabs: [string, string][] = [['/admin/tenants', 'Businesses'], ['/admin/support', 'Help inbox'], ['/admin/early-access', 'Early access'], ['/admin/system', 'System']];
  return (
    <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <span className="shrink-0 text-sm font-black tracking-tight">ClarityFlow <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">HQ</span></span>
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {tabs.map(([h, l]) => (
            <Link key={h} href={h} className={`h-9 shrink-0 rounded-full px-3.5 text-sm leading-9 ${path.startsWith(h) ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{l}</Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
