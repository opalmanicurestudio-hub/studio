'use client';
// src/components/staff-portal/StudioCard.tsx — THE STUDIO CARD for people who run their own business: booth renters and
// solo providers. Their name and brand on top, a ring for today (done of booked), today's booked value, the next client
// with their status, and three tiles — rent due (renters), open client cases, and how many clients rebooked this month.
import * as React from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { MiniCard } from '@/components/staff-portal/WeekSchedule';
import { bizKey, bizDayStart } from '@/lib/biz-clock';
import { addDays } from '@/lib/tenant-time';

const ms = (v: any) => (v?.toDate ? v.toDate().getTime() : typeof v?.seconds === 'number' ? v.seconds * 1000 : Date.parse(String(v || '')));
const LIVE = (a: any) => !['cancelled', 'canceled', 'no_show', 'expired', 'declined'].includes(String(a.status));

export function StudioCard({ firestore, tenantId, staffId, name, sub, logo, accent, mine, rentInvoice, onOpen, onCases, onRent }: { firestore: any; tenantId: string; staffId: string; name: string; sub: string; logo?: string | null; accent: string; mine: any[]; rentInvoice?: any; onOpen: (a: any) => void; onCases: () => void; onRent?: () => void }) {
  const q = useMemoFirebase(() => (firestore && tenantId && staffId ? query(collection(firestore, `tenants/${tenantId}/cases`), where('visit.providerId', '==', staffId)) : null), [firestore, tenantId, staffId]);
  const { data: cases } = useCollection<any>(q);
  // Today and this month are the business's (lib/biz-clock), not the phone's.
  const now = Date.now(); const k0 = bizKey(); const d0 = bizDayStart(k0); const d1 = bizDayStart(addDays(k0, 1)).getTime();
  const today = (mine || []).filter((a) => LIVE(a) && ms(a.startTime) >= d0.getTime() && ms(a.startTime) < d1).sort((a, b) => ms(a.startTime) - ms(b.startTime));
  const done = today.filter((a) => a.status === 'completed').length; const value = today.reduce((x, a) => x + (Number(a.price) || 0), 0);
  const next = today.find((a) => a.status === 'servicing') || today.find((a) => a.status !== 'completed' && ms(a.endTime || a.startTime) > now) || null;
  const m0 = bizDayStart(`${k0.slice(0, 8)}01`).getTime();
  const finished = (mine || []).filter((a) => a.status === 'completed' && ms(a.startTime) >= m0 && a.clientId);
  const rebooked = finished.filter((a) => (mine || []).some((b) => b.clientId === a.clientId && LIVE(b) && ms(b.startTime) > ms(a.startTime) && b.id !== a.id)).length;
  const openCases = (cases || []).filter((c: any) => !c.locked).length;
  const pct = today.length ? Math.round((done / today.length) * 100) : 0;
  const initials = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const due = rentInvoice ? ((Number(rentInvoice.amountCents) || 0) + (Number(rentInvoice.lateFeeCents) || 0)) / 100 : null;
  return (
    <div className="space-y-2.5 rounded-[24px] border border-[#ececee] bg-white p-3.5">
      <div className="flex items-center gap-3">
        {logo ? <img src={logo} alt="" className="h-11 w-11 rounded-[14px] object-cover" /> : <span className="flex h-11 w-11 items-center justify-center rounded-[14px] text-[15px] font-extrabold text-white" style={{ background: `linear-gradient(135deg, ${accent}, #d49a3a)` }}>{initials}</span>}
        <span className="min-w-0"><span className="block truncate text-[16px] font-extrabold">{name}</span><span className="block truncate text-[12.5px] text-[#6d7075]">{sub}</span></span>
      </div>
      <div className="flex items-center gap-4 rounded-[18px] bg-[#fafafa] p-3">
        <div className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(${accent} ${pct}%, #e6e6e8 0)` }} aria-label={`${done} of ${today.length} visits done today`}>
          <span className="absolute inset-[7px] rounded-full bg-[#fafafa]" /><span className="relative text-center leading-none"><b className="block text-[20px]">{today.length}</b><span className="text-[10px] text-[#6d7075]">today</span></span>
        </div>
        <div className="min-w-0 space-y-0.5"><span className="block text-[12px] text-[#6d7075]">Booked today</span><b className="block text-[22px] leading-none">${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}</b><span className="block text-[12px] text-[#6d7075]">{done} done{next ? ` · next at ${new Date(ms(next.startTime)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : today.length ? ' · all finished' : ''}</span></div>
      </div>
      {next && <MiniCard a={next} onOpen={onOpen} />}
      <div className="grid grid-cols-3 gap-2">
        {due !== null ? <button onClick={onRent} className="rounded-[14px] border border-[#ececee] p-2 text-left"><span className="block text-[10.5px] font-bold tracking-wide text-[#6d7075]">Rent</span><b className="block text-[16px]">${due.toFixed(0)}</b><span className="block text-[11px] text-[#6d7075]">{rentInvoice?.status === 'late' ? 'late' : `due ${String(rentInvoice?.dueDate || '').slice(5, 10).replace('-', '/')}`}</span></button>
          : <div className="rounded-[14px] border border-[#ececee] p-2"><span className="block text-[11px] font-bold text-[#6d7075]">Finished</span><b className="block text-[16px]">{finished.length}</b><span className="block text-[11px] text-[#6d7075]">this month</span></div>}
        <button onClick={onCases} className="rounded-[14px] border border-[#ececee] p-2 text-left"><span className="block text-[11px] font-bold text-[#6d7075]">Cases</span><b className="block text-[16px]">{openCases}</b><span className="block text-[11px] text-[#6d7075]">open</span></button>
        <div className="rounded-[14px] border border-[#ececee] p-2"><span className="block text-[11px] font-bold text-[#6d7075]">Rebooked</span><b className="block text-[16px]">{finished.length ? `${Math.round((rebooked / finished.length) * 100)}%` : '–'}</b><span className="block text-[11px] text-[#6d7075]">this month</span></div>
      </div>
    </div>);
}
