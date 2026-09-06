'use client';

// src/components/maintenance/InterruptionsCard.tsx
//
// A flood, a fire, a week with no power. This card is the filing cabinet that
// gets filled in WHILE it is happening, so the packet an insurer asks for six
// months later already exists: which days, which spaces, what each renter was
// owed and given, what was done and when, and what the renters were told.
//
// Money leaves only through the Approve buttons. The card computes what each
// affected renter would be owed at a day's rent per unusable day, priced off
// their own lease, and waits. Nothing abates on a schedule.

import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  INTERRUPTION_TYPE_LABEL, abatementProposals, exposureCents, interruptionDays, lossesByRenter,
  type InterruptionRecord, type InterruptionType,
} from '@/lib/interruptions';

const money = (c: number) => `$${(Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

export function InterruptionsCard({ tenantId, firestore, tenant, booths }: { tenantId: string; firestore: any; tenant: any; booths: any[] }) {
  const [records, setRecords] = useState<InterruptionRecord[]>([]);
  const [leases, setLeases] = useState<any[]>([]);
  const [renters, setRenters] = useState<any[]>([]);
  const [losses, setLosses] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: 'power' as InterruptionType, title: '', startDate: todayIso(), boothIds: [] as string[], note: '' });
  const [busy, setBusy] = useState('');
  const [remedyDraft, setRemedyDraft] = useState<Record<string, string>>({});
  const [shareDraft, setShareDraft] = useState<Record<string, boolean>>({});
  const [approveArm, setApproveArm] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsubs = [
      onSnapshot(collection(firestore, 'tenants', tenantId, 'interruptions'), (s) => setRecords(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as InterruptionRecord[]), () => setRecords([])),
      onSnapshot(collection(firestore, 'tenants', tenantId, 'leases'), (s) => setLeases(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => setLeases([])),
      onSnapshot(collection(firestore, 'tenants', tenantId, 'renters'), (s) => setRenters(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => setRenters([])),
      onSnapshot(collection(firestore, 'tenants', tenantId, 'interruptionLosses'), (s) => setLosses(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => setLosses([])),
    ];
    return () => unsubs.forEach((u) => u());
  }, [firestore, tenantId]);

  useEffect(() => { if (!approveArm) return; const t = setTimeout(() => setApproveArm(''), 5000); return () => clearTimeout(t); }, [approveArm]);

  const boothById = useMemo(() => { const m = new Map<string, any>(); for (const b of booths || []) m.set(b.id, b); return m; }, [booths]);
  const renterById = useMemo(() => { const m = new Map<string, any>(); for (const r of renters) m.set(r.id, r); return m; }, [renters]);
  const leasedBooths = useMemo(() => {
    const ids = new Set(leases.filter((l) => l.status === 'active').map((l) => l.boothId));
    return (booths || []).filter((b) => ids.has(b.id)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [booths, leases]);
  const openRecords = useMemo(() => records.filter((r) => r.status === 'open').sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))), [records]);
  const doneRecords = useMemo(() => records.filter((r) => r.status === 'resolved').sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))), [records]);

  const create = async () => {
    if (!firestore || !tenantId || !form.startDate) return;
    setBusy('new');
    try {
      const nowIso = new Date().toISOString();
      const ref = doc(collection(firestore, 'tenants', tenantId, 'interruptions'));
      const rec: InterruptionRecord = {
        id: ref.id, type: form.type,
        title: form.title.trim() || INTERRUPTION_TYPE_LABEL[form.type],
        startDate: form.startDate, endDate: null,
        affectedBoothIds: form.boothIds, status: 'open',
        note: form.note.trim().slice(0, 1200), remedy: [], abated: {},
        createdAt: nowIso, resolvedAt: null,
      };
      await setDoc(ref, rec);
      setOpen(false);
      setForm({ type: 'power', title: '', startDate: todayIso(), boothIds: [], note: '' });
    } finally { setBusy(''); }
  };

  const addRemedy = async (rec: InterruptionRecord) => {
    const text = (remedyDraft[rec.id] || '').trim();
    if (!firestore || !tenantId || !text) return;
    setBusy(`rem-${rec.id}`);
    try {
      const share = !!shareDraft[rec.id];
      const entry = { at: new Date().toISOString(), text: text.slice(0, 1200), sharedWithRenters: share };
      await updateDoc(doc(firestore, 'tenants', tenantId, 'interruptions', rec.id), { remedy: [...(rec.remedy || []), entry] });
      if (share) await tellRenters(rec, `Update on ${rec.title}: ${text}`);
      setRemedyDraft((m) => ({ ...m, [rec.id]: '' }));
    } finally { setBusy(''); }
  };

  // Every affected renter gets the same words, through the same door the rest
  // of their messages come through — email, text, and a line in their thread.
  // That is what makes it a record rather than a rumour.
  const tellRenters = async (rec: InterruptionRecord, text: string) => {
    const affected = abatementProposals(rec, leases, boothById, renterById, todayIso());
    const byName = (tenant && (tenant.name || tenant.businessName)) || 'Studio';
    await Promise.all(affected.map((p) => fetch('/api/booths/notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'renter-message', tenantId, renterId: p.renterId, text, byName }),
    }).catch(() => null)));
  };

  const approve = async (rec: InterruptionRecord, p: { renterId: string; leaseId: string; boothId: string | null; days: number; owedCents: number; renterName: string }) => {
    if (!firestore || !tenantId || p.owedCents <= 0) return;
    setBusy(`ab-${rec.id}-${p.renterId}`);
    try {
      const nowIso = new Date().toISOString();
      const ref = doc(collection(firestore, 'tenants', tenantId, 'rentLedger'));
      await setDoc(ref, {
        leaseId: p.leaseId, renterId: p.renterId, boothId: p.boothId,
        type: 'rent_abatement', status: 'paid', amountCents: -p.owedCents,
        description: `${rec.title} — space unusable ${p.days} day${p.days === 1 ? '' : 's'}`,
        note: '', dueDate: null, paidAt: nowIso.slice(0, 10), method: 'abatement', interruptionId: rec.id,
        stripePaymentIntentId: null, appliesToEntryIds: [], createdBy: 'owner', createdAt: nowIso, updatedAt: nowIso,
      });
      const prev = rec.abated?.[p.renterId];
      await updateDoc(doc(firestore, 'tenants', tenantId, 'interruptions', rec.id), {
        abated: { ...(rec.abated || {}), [p.renterId]: { cents: (Number(prev?.cents) || 0) + p.owedCents, days: p.days, at: nowIso } },
      });
    } finally { setBusy(''); setApproveArm(''); }
  };

  const resolve = async (rec: InterruptionRecord) => {
    if (!firestore || !tenantId) return;
    setBusy(`res-${rec.id}`);
    try {
      const nowIso = new Date().toISOString();
      await updateDoc(doc(firestore, 'tenants', tenantId, 'interruptions', rec.id), { status: 'resolved', endDate: rec.endDate || todayIso(), resolvedAt: nowIso });
    } finally { setBusy(''); }
  };

  const Rec = ({ rec }: { rec: InterruptionRecord }) => {
    const props = abatementProposals(rec, leases, boothById, renterById, todayIso());
    const exp = exposureCents(props);
    const days = interruptionDays(rec.startDate, rec.endDate, todayIso());
    const isOpen = rec.status === 'open';
    const scope = (rec.affectedBoothIds || []).length === 0
      ? 'Whole studio'
      : rec.affectedBoothIds.map((id) => boothById.get(id)?.name || 'Space').join(', ');
    return (
      <div className={cn('rounded-2xl border-2 px-4 py-3 space-y-3', isOpen ? 'border-red-300 bg-red-50/60' : 'bg-white')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black truncate">{rec.title}</p>
            <p className="text-[11px] font-bold text-slate-600">{INTERRUPTION_TYPE_LABEL[rec.type] || rec.type} · {rec.startDate}{rec.endDate ? ` → ${rec.endDate}` : ' → ongoing'} · {days} day{days === 1 ? '' : 's'} · {scope}</p>
          </div>
          <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest', isOpen ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600')}>{isOpen ? 'Open' : 'Resolved'}</span>
        </div>
        {rec.note && <p className="text-[11px] font-medium text-slate-700">{rec.note}</p>}

        {props.length > 0 && (
          <div className="rounded-xl bg-white border-2 px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Rent owed back · a day's rent per unusable day</p>
              <p className="text-[11px] font-black tabular-nums">{money(exp.owedCents)} to approve{exp.paidCents > 0 ? ` · ${money(exp.paidCents)} given` : ''}</p>
            </div>
            {props.map((p) => {
              const key = `${rec.id}-${p.renterId}`;
              const armed = approveArm === key;
              return (
                <div key={key} className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold truncate">{p.renterName}<span className="text-slate-500 font-medium"> · {p.boothName} · {money(p.dailyCents)}/day</span></p>
                  {p.owedCents > 0 ? (
                    <button type="button" disabled={busy === `ab-${key}`}
                      onClick={() => { if (armed) void approve(rec, p); else setApproveArm(key); }}
                      className={cn('shrink-0 h-8 rounded-lg px-2.5 text-[9px] font-black uppercase tracking-widest disabled:opacity-40', armed ? 'bg-emerald-700 text-white' : 'border-2 border-emerald-300 text-emerald-800')}>
                      {armed ? `Tap again · credit ${money(p.owedCents)}` : `Credit ${money(p.owedCents)}`}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-emerald-700">{money(p.paidCents)} credited</span>
                  )}
                </div>
              );
            })}
            <p className="text-[9px] font-bold text-slate-400">Renters already on leave are left out — their rent is already paused or reduced, and crediting it again pays twice for one empty chair.</p>
          </div>
        )}

        {(() => {
          const groups = lossesByRenter(losses.filter((l) => l.interruptionId === rec.id));
          if (groups.length === 0) return null;
          return (
            <div className="rounded-xl bg-white border-2 px-3 py-2.5 space-y-1">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">What renters say it cost them · their own logs, read-only</p>
              {groups.map((g) => (
                <p key={g.renterId} className="text-[11px] font-bold flex justify-between gap-2"><span className="truncate">{g.renterName}<span className="font-medium text-slate-500"> · {g.totals.days} day{g.totals.days === 1 ? '' : 's'} · {g.totals.appointmentsLost} appt{g.totals.appointmentsLost === 1 ? '' : 's'}</span></span><span className="tabular-nums">{money(g.totals.lostCents)}</span></p>
              ))}
              <p className="text-[9px] font-bold text-slate-400">Their figures for their own insurer — separate from rent, not owed by you.</p>
            </div>
          );
        })()}

        <div className="space-y-1.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">What's being done</p>
          {(rec.remedy || []).length === 0 && <p className="text-[11px] font-medium text-slate-500">Nothing logged yet.</p>}
          {(rec.remedy || []).map((r, i) => (
            <p key={i} className="text-[11px] font-medium text-slate-700"><span className="font-black">{String(r.at).slice(0, 10)}</span> · {r.text}{r.sharedWithRenters && <span className="text-emerald-700 font-black"> · sent to renters</span>}</p>
          ))}
          {isOpen && (
            <div className="space-y-1.5">
              <textarea value={remedyDraft[rec.id] || ''} onChange={(e) => setRemedyDraft((m) => ({ ...m, [rec.id]: e.target.value }))} rows={2}
                aria-label="Update on the remedy" placeholder="Plumber booked for Tuesday. Dryers back Thursday."
                className="w-full rounded-xl border-2 bg-white px-3 py-2 text-sm" />
              <div className="flex items-center gap-2">
                <button type="button" aria-pressed={!!shareDraft[rec.id]} onClick={() => setShareDraft((m) => ({ ...m, [rec.id]: !m[rec.id] }))}
                  className={cn('h-9 rounded-lg border-2 px-3 text-[9px] font-black uppercase tracking-widest', shareDraft[rec.id] ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600')}>
                  {shareDraft[rec.id] ? 'Will message affected renters' : 'Keep internal'}
                </button>
                <Button onClick={() => addRemedy(rec)} disabled={busy === `rem-${rec.id}` || !(remedyDraft[rec.id] || '').trim()} className="h-9 flex-1 rounded-lg font-black uppercase text-[9px] tracking-widest">{busy === `rem-${rec.id}` ? '…' : 'Log it'}</Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <a href={`/api/booths/interruption-packet?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(rec.id)}`} target="_blank" rel="noopener"
            className="h-9 inline-flex flex-1 items-center justify-center rounded-lg border-2 bg-white text-[9px] font-black uppercase tracking-widest text-slate-700">Print packet</a>
          {isOpen && (
            <Button variant="outline" onClick={() => resolve(rec)} disabled={busy === `res-${rec.id}`} className="h-9 flex-1 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest">{busy === `res-${rec.id}` ? '…' : 'Mark resolved · ends today'}</Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card className="rounded-[2rem] border-2">
      <CardHeader className="p-5 pb-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-[11px] font-black uppercase tracking-widest">Business interruption</CardTitle>
            <p className="text-[11px] font-bold text-slate-500">Flood, fire, power, weather, a forced closure. Record it while it happens: the days, the spaces, what renters are owed, what was done, what they were told. The packet your insurer asks for later is written now.</p>
          </div>
          {!open && <Button onClick={() => setOpen(true)} className="h-9 shrink-0 rounded-xl bg-red-700 hover:bg-red-800 font-black uppercase text-[9px] tracking-widest">Report one</Button>}
        </div>
      </CardHeader>
      <CardContent className="p-5 pt-2 space-y-3">
        {open && (
          <div className="rounded-2xl border-2 border-red-300 bg-white px-4 py-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as InterruptionType }))} aria-label="What happened"
                className="h-10 rounded-xl border-2 bg-white px-3 text-sm font-bold">
                {(Object.keys(INTERRUPTION_TYPE_LABEL) as InterruptionType[]).map((t) => <option key={t} value={t}>{INTERRUPTION_TYPE_LABEL[t]}</option>)}
              </select>
              <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} aria-label="First day affected" className="h-10 rounded-xl border-2 bg-white px-3 text-sm font-bold" />
            </div>
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value.slice(0, 120) }))} aria-label="Short title" placeholder="Burst pipe in the back room" className="h-10 w-full rounded-xl border-2 bg-white px-3 text-sm font-bold" />
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Spaces affected · none ticked means the whole studio</p>
              <div className="flex flex-wrap gap-1.5">
                {leasedBooths.map((b) => {
                  const on = form.boothIds.includes(b.id);
                  return (
                    <button key={b.id} type="button" aria-pressed={on} onClick={() => setForm((f) => ({ ...f, boothIds: on ? f.boothIds.filter((x) => x !== b.id) : [...f.boothIds, b.id] }))}
                      className={cn('h-9 rounded-full border-2 px-3 text-[10px] font-black uppercase tracking-widest', on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600')}>{b.name}</button>
                  );
                })}
                {leasedBooths.length === 0 && <p className="text-[11px] font-medium text-slate-500">No leased spaces right now — the record still keeps the dates and the remedy log.</p>}
              </div>
            </div>
            <textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value.slice(0, 1200) }))} rows={2} aria-label="What happened, in your words" placeholder="What happened, who found it, who has been called." className="w-full rounded-xl border-2 bg-white px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <Button onClick={create} disabled={busy === 'new' || !form.startDate} className="h-10 flex-1 rounded-xl font-black uppercase text-[10px] tracking-widest">{busy === 'new' ? '…' : 'Open the record'}</Button>
              <Button variant="outline" onClick={() => setOpen(false)} className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Cancel</Button>
            </div>
          </div>
        )}
        {openRecords.map((r) => <Rec key={r.id} rec={r} />)}
        {openRecords.length === 0 && !open && <p className="text-[11px] font-medium text-slate-500">Nothing open. Good.</p>}
        {doneRecords.length > 0 && (
          <div className="space-y-2">
            <button type="button" onClick={() => setShowResolved((v) => !v)} aria-expanded={showResolved} className="text-[9px] font-black uppercase tracking-widest text-slate-500">
              {showResolved ? 'Hide' : 'Show'} {doneRecords.length} resolved
            </button>
            {showResolved && doneRecords.map((r) => <Rec key={r.id} rec={r} />)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
