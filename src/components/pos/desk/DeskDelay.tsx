'use client';
// src/components/pos/desk/DeskDelay.tsx — RUNNING LATE: IMPACT & OPTIONS.
//
// A late arrival is a schedule decision, not an automatic fee. Staff enter the
// ETA; the panel works out what it affects (the full service, the provider's
// next booking) and which options still work WITHOUT creating a conflict:
//   keep the full service (only if it fits) · condense (drop add-ons, client
//   agrees) · switch to a provider who is genuinely free · reschedule · cancel.
// The business's late policy (grace period, fee) is shown and applied only when
// staff confirm — waivable with a reason. Nothing is charged, shortened, moved
// or cancelled silently. The decision is stored on the appointment, the
// provider(s) told, and the next client warned only if still at risk.

import { getAuth } from 'firebase/auth';
import { lateReplyText, type LateOption } from '@/lib/late-reply';
import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { writeBatch, doc, collection, arrayUnion, increment } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { logAuditClient } from '@/lib/audit-client';
import { Drawer, Btn, Pill } from './kit';

const toDate = (v: any): Date | null => { if (!v) return null; try { const d = v?.toDate ? v.toDate() : v instanceof Date ? v : typeof v === 'string' ? parseISO(v) : new Date(v); return isNaN(d.getTime()) ? null : d; } catch { return null; } };
const hm = (d: Date) => format(d, 'h:mm a');
const DONE = ['cancelled', 'canceled', 'no_show', 'completed', 'expired', 'declined', 'draft', 'held', 'requested'];

export function DeskDelay({ e, appt, accent, onClose, onReschedule }: { e: any; appt: any | null; accent?: string | null; onClose: () => void; onReschedule?: (a: any) => void }) {
  const [late, setLate] = useState(10);
  const [drop, setDrop] = useState<string[]>([]); const [agreed, setAgreed] = useState(false);
  const [applyFee, setApplyFee] = useState(true); const [waiveWhy, setWaiveWhy] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [tellClient, setTellClient] = useState(true); const [sent, setSent] = useState<string | null>(null);
  useEffect(() => { if (appt) { const now = Date.now(), st = toDate(appt.startTime)?.getTime() || now; setTellClient(true); setSent(null); const told = Number(appt.clientLateMinutes || (appt.checkInStatus === 'running_late' ? appt.lateTimeMinutes : 0)) || 0; if (told > 0) { setLate([5, 10, 15, 20, 30, 45].reduce((b, m) => (Math.abs(m - told) < Math.abs(b - told) ? m : b), 10)); setDrop([]); setAgreed(false); setApplyFee(true); setWaiveWhy(''); setErr(''); return; } setLate(Math.max(5, Math.round((now - st) / 60000 / 5) * 5 || 10)); setDrop([]); setAgreed(false); setApplyFee(true); setWaiveWhy(''); setErr(''); } }, [appt?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = e.selectedTenant || {};
  const svc = (id: string) => (e.services || []).find((s: any) => s.id === id);
  const model = useMemo(() => {
    if (!appt) return null;
    const start = toDate(appt.startTime) || new Date();
    const arrive = new Date(start.getTime() + late * 60000);
    const main = svc(appt.serviceId); const addOns = ((appt.addOnIds || []) as string[]).map((id) => ({ id, s: svc(id) })).filter((x) => x.s);
    const padAfter = Number(main?.padAfter || 0);
    const mins = (dropIds: string[]) => Number(main?.duration || 60) + addOns.filter((a) => !dropIds.includes(a.id)).reduce((n, a) => n + Number(a.s.duration || 0), 0);
    const today = (e.appointmentsFromInventory || []).filter((a: any) => a.id !== appt.id && !DONE.includes(String(a.status || '')) && !a.isBlock && !a.isHold);
    const nextFor = (sid: string) => today.filter((a: any) => a.staffId === sid && (toDate(a.startTime)?.getTime() || 0) >= start.getTime()).sort((x: any, y: any) => toDate(x.startTime)!.getTime() - toDate(y.startTime)!.getTime())[0] || null;
    const next = appt.staffId ? nextFor(appt.staffId) : null;
    const fits = (sid: string | null, dropIds: string[]) => { const end = arrive.getTime() + (mins(dropIds) + padAfter) * 60000; const n = sid ? nextFor(sid) : null; return !n || end <= toDate(n.startTime)!.getTime(); };
    const busyBetween = (sid: string, a: number, b: number) => today.some((x: any) => x.staffId === sid && (toDate(x.startTime)?.getTime() || 0) < b && (toDate(x.endTime)?.getTime() || (toDate(x.startTime)!.getTime() + 60 * 60000)) > a);
    // Smallest set of add-ons to drop so the service fits (largest first).
    const suggest: string[] = []; if (!fits(appt.staffId, [])) for (const a of [...addOns].sort((x, y) => Number(y.s.duration || 0) - Number(x.s.duration || 0))) { suggest.push(a.id); if (fits(appt.staffId, suggest)) break; }
    const canCondense = suggest.length > 0 && fits(appt.staffId, suggest);
    const others = (e.staff || []).filter((s: any) => s.id !== appt.staffId && s.isActive !== false && !s.isStudent && (!Array.isArray(s.serviceIds) || !s.serviceIds.length || s.serviceIds.includes(appt.serviceId)))
      .filter((s: any) => !busyBetween(s.id, arrive.getTime(), arrive.getTime() + (mins([]) + padAfter) * 60000) && fits(s.id, []));
    const grace = Number(t.lateArrivalGracePeriod ?? 15), rate = Number(t.tmhr || 50), premium = Number(t.lateInconveniencePremium || 0);
    const fee = late > grace ? Number(((late / 60) * rate + premium).toFixed(2)) : 0;
    return { start, arrive, addOns, mins, next, fits, suggest, canCondense, others, grace, fee, autoCancel: t.autoCancelLateArrivals === true, padAfter };
  }, [appt, late, e.appointmentsFromInventory, e.staff, e.services]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!appt || !model) return <Drawer accent={accent} open={false} onClose={onClose} title="Running late">{null}</Drawer>;
  const first = String(appt.clientName || 'the guest').split(' ')[0];
  const provider = (e.staff || []).find((s: any) => s.id === appt.staffId);
  const fullFits = model.fits(appt.staffId, []);
  const dropFits = drop.length > 0 && model.fits(appt.staffId, drop);
  const endFor = (dropIds: string[]) => new Date(model.arrive.getTime() + model.mins(dropIds) * 60000);
  const nextName = model.next ? String(model.next.clientName || 'their next guest').split(' ')[0] : null;
  const nextPhone = model.next ? String(((e.clients || []).find((c: any) => c.id === model.next.clientId)?.phone) || '').replace(/[^\d+]/g, '') : '';

  // Tell the client what happens next (server: text + email + their visit link shows it).
  const tellThem = async (option: LateOption) => {
    const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
    const r = await fetch('/api/appointments/late-decision', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
      body: JSON.stringify({ tenantId: e.tenantId, appointmentId: appt.id, option, tell: tellClient }) }).then((x) => x.json()).catch(() => ({}));
    return r;
  };
  const askToMove = async () => {
    setBusy(true); setErr('');
    const r = await tellThem('move');
    setBusy(false);
    if (r?.ok) { setSent(`${first} has been asked to choose a new time${tellClient ? '' : ' (not messaged — tell them yourself)'}. Their slot stays on the planner until they move it.`); }
    else setErr(r?.error || 'That didn’t send — please try again.');
  };
  const decide = async (option: 'keep' | 'condense' | 'switch' | 'note', toStaff?: any) => {
    if (!e.firestore || !e.tenantId) return;
    if (option === 'condense' && !agreed) { setErr(`Confirm ${first} agreed to the shorter service.`); return; }
    const charging = option !== 'note' && model.fee > 0 && applyFee;
    if (option !== 'note' && model.fee > 0 && !applyFee && !waiveWhy.trim()) { setErr('Add a reason for waiving the late fee.'); return; }
    setBusy(true); setErr('');
    const nowIso = new Date().toISOString(); const by = e.currentUser?.displayName || 'Front desk';
    const decision: any = { option, minutesLate: late, etaAt: model.arrive.toISOString(), decidedAt: nowIso, decidedBy: by,
      ...(option === 'condense' ? { droppedAddOnIds: drop, clientAgreed: true } : {}), ...(option === 'switch' ? { fromStaffId: appt.staffId || null, toStaffId: toStaff.id } : {}),
      ...(option !== 'note' && model.fee > 0 ? { fee: charging ? model.fee : 0, feeWaived: !charging, waiveReason: charging ? null : waiveWhy.trim() } : {}) };
    const patch: any = { checkInStatus: 'running_late', lateTimeMinutes: late, etaAt: model.arrive.toISOString(), lateUpdatedAt: nowIso, lateDecision: decision,
      ...(option === 'condense' ? { addOnIds: (appt.addOnIds || []).filter((id: string) => !drop.includes(id)) } : {}),
      ...(option === 'switch' ? { staffId: toStaff.id, staffName: toStaff.name } : {}) };
    try {
      const b = writeBatch(e.firestore);
      b.update(doc(e.firestore, 'tenants', e.tenantId, 'appointments', appt.id), patch);
      if (appt.checkInToken) b.set(doc(e.firestore, 'appointmentCheckIns', appt.checkInToken), { checkInStatus: 'running_late', lateTimeMinutes: late, etaAt: patch.etaAt, tenantId: e.tenantId, ...(option === 'switch' ? { staffId: toStaff.id } : {}) }, { merge: true });
      if (charging && appt.clientId) b.update(doc(e.firestore, 'tenants', e.tenantId, 'clients', appt.clientId), { outstandingBalance: increment(model.fee), unpaidFees: arrayUnion({ feeId: nanoid(), appointmentId: appt.id, appointmentDate: model.start.toISOString(), feeAmount: model.fee, reason: `Late arrival: +${late}m` }) });
      const tell = (who: any, msg: string) => { if (!who) return; const n = doc(collection(e.firestore, 'tenants', e.tenantId, 'notifications')); b.set(n, { id: n.id, userId: who.userId || who.uid || who.id, read: false, createdAt: nowIso, type: 'guest_running_late', link: 'pos', message: msg }); };
      const what = option === 'keep' ? 'keeping the full service' : option === 'condense' ? `dropping ${drop.map((id) => svc(id)?.name).filter(Boolean).join(', ')}` : option === 'switch' ? `moved to ${toStaff.name}` : 'ETA noted';
      tell(provider, `${appt.clientName || 'Your guest'} is running ${late} min late (arriving ~${hm(model.arrive)}) — ${what}.`);
      if (option === 'switch') tell(toStaff, `${appt.clientName || 'A guest'} has been moved to you — arriving ~${hm(model.arrive)} for ${svc(appt.serviceId)?.name || 'their appointment'}.`);
      await b.commit();
      await logAuditClient(e.firestore, e.tenantId, { action: 'appointment.late_decision', targetType: 'appointment', targetId: appt.id, amount: charging ? model.fee : undefined,
        summary: `${appt.clientName || 'Guest'} running ${late} min late — ${what}${model.fee > 0 && option !== 'note' ? (charging ? ` · late fee $${model.fee.toFixed(2)}` : ` · fee waived (${waiveWhy.trim()})`) : ''}`,
        actor: { type: 'user', id: e.currentUser?.uid || null, name: by, role: e.role || 'staff', via: 'front desk' } } as any);
      if (option !== 'note') await tellThem(option);
      onClose();
    } catch { setErr('That didn’t save — please try again.'); } finally { setBusy(false); }
  };

  const Box = ({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'ok' }) => <section className="space-y-2 rounded-3xl p-4" style={{ background: tone === 'warn' ? 'color-mix(in srgb, var(--warn) 8%, var(--card))' : 'var(--card)' }}>{children}</section>;
  const H = ({ children }: { children: React.ReactNode }) => <p className="text-[14px] font-semibold">{children}</p>;

  return (
    <Drawer accent={accent} open={!!appt} onClose={onClose} title={`${first} is running late`}>
      <div className="space-y-3">
        {(appt?.clientCheckInStatus === 'running_late' || appt?.clientLateNote) && <Box tone="warn"><H>{first} told us</H>
          <p className="text-[14px]">About {Number(appt.clientLateMinutes || appt.lateTimeMinutes) || '?'} minutes late{appt.clientLateNote ? ` — “${appt.clientLateNote}”` : ''}.</p></Box>}
        {sent && <Box tone="ok"><p className="text-[14px]">{sent}</p><Btn onClick={onClose}>Done</Btn></Box>}
        <Box><div className="flex items-center justify-between gap-3"><H>Tell {first} what happens</H>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={tellClient} onChange={(ev) => setTellClient(ev.target.checked)} /> Send</label></div>
          <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{tellClient ? `When you choose below, ${first} gets a text/email and their visit link updates — e.g. “${lateReplyText('keep', { first, studio: t.name || '', provider: provider?.name ? String(provider.name).split(' ')[0] : null, eta: hm(model.arrive) })}”` : `${first} won’t be messaged — tell them yourself.`}</p></Box>
        <Box><H>When will they arrive?</H>
          <div className="flex flex-wrap gap-1.5">{[5, 10, 15, 20, 30, 45].map((m) => <Btn key={m} quiet={late !== m} onClick={() => setLate(m)}>{m} min</Btn>)}</div>
          <p className="text-[14px]">Booked {hm(model.start)} → arriving about <b>{hm(model.arrive)}</b></p></Box>

        <Box tone={fullFits ? 'ok' : 'warn'}><H>What it affects</H>
          <p className="text-[14px]">Full service: {model.mins([])} min{model.addOns.length ? ` (incl. ${model.addOns.map((a) => a.s.name).join(', ')})` : ''} → finishes <b>{hm(endFor([]))}</b>{model.padAfter ? ` + ${model.padAfter} min clean-up` : ''}</p>
          {model.next ? <p className="text-[14px]">{provider?.name?.split(' ')[0] || 'Their provider'}’s next: <b>{nextName} at {hm(toDate(model.next.startTime)!)}</b> — {fullFits ? <span style={{ color: 'var(--ok)', fontWeight: 600 }}>still fits</span> : <span style={{ color: 'var(--warn)', fontWeight: 600 }}>would run {Math.round((endFor([]).getTime() + model.padAfter * 60000 - toDate(model.next.startTime)!.getTime()) / 60000)} min into it</span>}</p>
            : <p className="text-[14px]">Nothing booked after them with {provider?.name?.split(' ')[0] || 'this provider'} today.</p>}
        </Box>

        <Box><H>Options</H>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3"><span className="text-[14px]"><b>Keep the full service</b><span className="block text-[12px]" style={{ color: 'var(--muted)' }}>{fullFits ? `Finishes ${hm(endFor([]))}` : 'Doesn’t fit without affecting the next guest'}</span></span><Btn onClick={() => decide('keep')} disabled={!fullFits || busy}>Keep</Btn></div>
            {model.addOns.length > 0 && <div className="space-y-1.5 rounded-2xl p-3" style={{ background: 'var(--soft)' }}>
              <p className="text-[14px] font-semibold">Condense — drop add-ons {model.canCondense && !drop.length && <button type="button" className="ml-1 text-[12px] underline" onClick={() => setDrop(model.suggest)}>suggest</button>}</p>
              {model.addOns.map((a) => <label key={a.id} className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={drop.includes(a.id)} onChange={(ev) => setDrop(ev.target.checked ? [...drop, a.id] : drop.filter((x) => x !== a.id))} /> {a.s.name} <span style={{ color: 'var(--muted)' }}>−{a.s.duration || 0} min</span></label>)}
              {drop.length > 0 && <><p className="text-[13px]">Finishes {hm(endFor(drop))} — {dropFits ? <span style={{ color: 'var(--ok)', fontWeight: 600 }}>fits</span> : <span style={{ color: 'var(--warn)', fontWeight: 600 }}>still doesn’t fit</span>}</p>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={agreed} onChange={(ev) => setAgreed(ev.target.checked)} /> {first} agreed to the shorter service</label>
                <Btn onClick={() => decide('condense')} disabled={!dropFits || busy}>Drop and keep the time</Btn></>}
            </div>}
            {model.others.length > 0 && <div className="space-y-1.5"><p className="text-[14px] font-semibold">Switch provider — free for the whole service</p>
              <div className="flex flex-wrap gap-1.5">{model.others.map((s: any) => <Btn key={s.id} quiet onClick={() => decide('switch', s)} disabled={busy}>Move to {String(s.name).split(' ')[0]}</Btn>)}</div></div>}
            <div className="flex flex-wrap gap-2 pt-1"><Btn quiet onClick={askToMove} disabled={busy}>Ask them to pick a new time</Btn><Btn quiet onClick={() => { onClose(); if (onReschedule) onReschedule(appt); else { e.setSelectedAppointment(appt); e.setIsDetailsOpen(true); } }}>Move it myself…</Btn><Btn quiet onClick={() => { onClose(); e.handleCancelAction(appt.id, false); }}>Not today (cancel)…</Btn><Btn quiet onClick={() => decide('note')} disabled={busy}>Just note the ETA</Btn></div>
          </div>
        </Box>

        {model.fee > 0 && <Box><H>Your late policy</H>
          <p className="text-[14px]">{late} min is past your {model.grace}-min grace period. Late fee: <b>${model.fee.toFixed(2)}</b>{model.autoCancel ? ' · your settings suggest rescheduling or cancelling past the grace period' : ''}.</p>
          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={applyFee} onChange={(ev) => setApplyFee(ev.target.checked)} /> Add the late fee to what {first} owes</label>
          {!applyFee && <input value={waiveWhy} onChange={(ev) => setWaiveWhy(ev.target.value)} placeholder="Reason for waiving (required)" className="h-11 w-full rounded-xl px-3 text-[14px] outline-none" style={{ background: 'var(--soft)' }} />}
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Applied only when you choose an option above — never automatically.</p></Box>}

        {model.next && !fullFits && <Box tone="warn"><H>Protect the next guest</H>
          <p className="text-[14px]">If you keep things as they are, <b>{nextName}</b> at {hm(toDate(model.next.startTime)!)} may wait. Choose an option above that fits — or give them a heads-up.</p>
          {nextPhone && <Btn quiet onClick={() => { window.location.href = `sms:${nextPhone}?&body=${encodeURIComponent(`Hi ${nextName}, a quick heads-up from ${t.name || 'us'}: we may be running a few minutes behind for your ${hm(toDate(model.next.startTime)!)} appointment. We'll keep you posted.`)}`; }}>Text {nextName} a heads-up</Btn>}</Box>}

        {err && <p className="text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>{err}</p>}
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}><Pill>Recorded</Pill> Every decision, fee or waiver is saved on the appointment and in the activity log.</p>
      </div>
    </Drawer>
  );
}
