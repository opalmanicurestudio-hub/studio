'use client';
// src/components/pos/desk/DeskCheckIn.tsx — CHECK-IN, IN SIX STEPS.
//
// Opens whenever the POS has a guest to check in (card "Check in", Scan / find).
//   1 Found       who this is, and "not them?" → search again
//   2 The visit   business/renter, time (early/late), services, provider, station, status
//   3 Contact     review/update — saved to their PROFILE or THIS VISIT ONLY (asked when
//                 something changes). Never signs anyone up for marketing.
//   4 Needed      only what this booking needs: unfinished forms (hand over the device
//                 or text the link); today's accommodations are optional and stay on
//                 the visit unless "remember on their profile" is ticked.
//   5 Payment     deposit paid / awaiting, anything owed, who the payment goes to
//   6 Arrival     check-in time + early/late recorded, optional note for the provider,
//                 and the provider is told (notification) — then the card moves on.

import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { writeBatch, doc, collection } from 'firebase/firestore';
import { logAuditClient } from '@/lib/audit-client';
import { Drawer, Btn, Pill, Seg } from './kit';

const toDate = (v: any): Date | null => { if (!v) return null; try { const d = v?.toDate ? v.toDate() : v instanceof Date ? v : typeof v === 'string' ? parseISO(v) : new Date(v); return isNaN(d.getTime()) ? null : d; } catch { return null; } };
const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;
const clean = (o: any) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 rounded-3xl p-4" style={{ background: 'var(--card)' }} aria-label={title}>
      <p className="flex items-center gap-2 text-[14px] font-semibold"><span className="flex h-6 w-6 items-center justify-center rounded-full text-[12px]" style={{ background: 'var(--soft)' }}>{n}</span>{title}</p>
      {children}
    </section>
  );
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3 text-[14px]"><span style={{ color: 'var(--muted)' }}>{k}</span><span className="min-w-0 text-right">{children}</span></div>;
}

export function DeskCheckIn({ e, accent }: { e: any; accent?: string | null }) {
  const item = e.pendingCheckInItem;
  const isWalkIn = !!item?.serviceIds && !item?.startTime;
  const client = item?.clientId ? (e.clients || []).find((c: any) => c.id === item.clientId) : null;
  const svc = (id: string) => (e.services || []).find((s: any) => s.id === id);
  const provider = item?.staffId ? (e.staff || []).find((s: any) => s.id === item.staffId) : null;
  const renter = item?.renterId ? (e.staff || []).find((s: any) => s.renterId === item.renterId || (s.id === item.staffId && s.isRenter)) : null;
  const at = toDate(item?.startTime);

  const initial = useMemo(() => ({ name: client?.name || item?.clientName || item?.customerName || '', phone: client?.phone || item?.clientPhone || item?.phone || '', email: client?.email || item?.clientEmail || item?.email || '',
    channel: client?.notificationPreferences?.confirmationChannel || 'sms', language: client?.preferredLanguage || 'English' }), [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [c, setC] = useState(initial); const [saveTo, setSaveTo] = useState<'profile' | 'visit' | null>(null);
  const [needs, setNeeds] = useState(''); const [rememberNeeds, setRememberNeeds] = useState(false);
  const [note, setNote] = useState(''); const [notify, setNotify] = useState(true); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { setC(initial); setSaveTo(null); setNeeds(''); setRememberNeeds(false); setNote(''); setNotify(true); setErr(''); }, [initial]);
  if (!item) return null;

  const changed = (['name', 'phone', 'email', 'channel', 'language'] as const).some((k) => String(c[k] || '') !== String((initial as any)[k] || ''));
  const now = new Date(); const offset = at ? Math.round((now.getTime() - at.getTime()) / 60000) : 0;
  const arrival = !at ? 'Arriving now' : offset < -2 ? `${-offset} min early` : offset > 2 ? `${offset} min late` : 'Right on time';
  const formsPending = !!item.completionStatus && item.completionStatus !== 'completed';
  const link = item.checkInToken && typeof window !== 'undefined' ? `${window.location.origin}/check-in/${item.checkInToken}` : null;
  const fees: any[] = client?.unpaidFees || [];
  const owed = fees.reduce((s, f) => s + (Number(f.feeAmount) || 0), 0);
  const depositPaid = item.depositStatus === 'paid' ? Number(item.depositAmount || item.depositPaidAmount || 0) : 0;
  const awaitingDeposit = ['pending_payment', 'deposit_pending'].includes(String(item.status));
  const services = [svc(item.serviceId)?.name || item.serviceName, ...((item.serviceIds || []) as string[]).map((id) => svc(id)?.name)].filter(Boolean);
  const addOns = ((item.addOnIds || []) as string[]).map((id) => svc(id)?.name).filter(Boolean);
  const first = (c.name || 'guest').split(' ')[0];

  const close = () => e.setPendingCheckInItem(null);
  const checkIn = async () => {
    if (changed && !saveTo) { setErr('Choose whether the contact changes go on their profile or just this visit.'); return; }
    if (!e.firestore || !e.tenantId) return;
    setBusy(true); setErr('');
    const nowIso = new Date().toISOString();
    const visitContact = changed && saveTo === 'visit' ? clean({ name: c.name, phone: c.phone, email: c.email, channel: c.channel, language: c.language }) : undefined;
    const updates: any = clean({ checkInStatus: 'arrived', checkInStatusTimestamp: nowIso, arrivalOffsetMinutes: at ? offset : undefined, arrivalNote: note.trim() || undefined,
      sensoryNeeds: needs.trim() || undefined, visitContact, checkedInVia: 'front desk' });
    try {
      const b = writeBatch(e.firestore);
      b.update(doc(e.firestore, 'tenants', e.tenantId, isWalkIn ? 'walkIns' : 'appointments', item.id), updates);
      if (!isWalkIn && item.checkInToken) b.set(doc(e.firestore, 'appointmentCheckIns', item.checkInToken), { ...updates, tenantId: e.tenantId }, { merge: true });
      if (item.clientId && ((changed && saveTo === 'profile') || (rememberNeeds && needs.trim()))) {
        b.set(doc(e.firestore, 'tenants', e.tenantId, 'clients', item.clientId), clean({
          ...(changed && saveTo === 'profile' ? { name: c.name || undefined, phone: c.phone || undefined, email: c.email || undefined, preferredLanguage: c.language, notificationPreferences: { ...(client?.notificationPreferences || {}), confirmationChannel: c.channel, reminderChannel: c.channel } } : {}),
          ...(rememberNeeds && needs.trim() ? { sensoryNeeds: needs.trim() } : {}),
        }), { merge: true });
      }
      if (notify && provider) {
        const n = doc(collection(e.firestore, 'tenants', e.tenantId, 'notifications'));
        b.set(n, { id: n.id, userId: provider.userId || provider.uid || provider.id, read: false, createdAt: nowIso, type: 'guest_arrived', link: 'pos',
          message: `${c.name || 'Your guest'} is here for ${services[0] || 'their appointment'}${at ? ` (${format(at, 'h:mm a')}, ${arrival.toLowerCase()})` : ''}.${note.trim() ? ` Note: ${note.trim()}` : ''}` });
      }
      await b.commit();
      await logAuditClient(e.firestore, e.tenantId, { action: 'checkin.front_desk', targetType: isWalkIn ? 'walkIn' : 'appointment', targetId: item.id, summary: `${c.name || 'Guest'} checked in at the front desk — ${arrival.toLowerCase()}`, actor: { type: 'user', id: e.currentUser?.uid || null, name: e.currentUser?.displayName || 'Front desk', role: e.role || 'staff', via: 'front desk' } } as any);
      close();
    } catch (x: any) { setErr('Check-in didn’t save — please try again.'); } finally { setBusy(false); }
  };

  const field = (k: 'name' | 'phone' | 'email', label: string, type = 'text') => (
    <label className="block text-[13px]"><span style={{ color: 'var(--muted)' }}>{label}</span>
      <input type={type} value={c[k]} onChange={(ev) => setC({ ...c, [k]: ev.target.value })} className="mt-1 h-11 w-full rounded-xl px-3 text-[15px] outline-none" style={{ background: 'var(--soft)' }} /></label>
  );

  return (
    <Drawer accent={accent} open={!!item} onClose={close} title={`Check in ${first}`}>
      <div className="space-y-3">
        <Step n={1} title="Found">
          <p className="text-[15px]"><b>{c.name || 'Guest'}</b>{isWalkIn ? ' · walk-in' : item.confirmationCode ? ` · #${item.confirmationCode}` : ''}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1"><button type="button" onClick={() => { close(); e.setIsScanLookupOpen?.(true); }} className="text-[13px] underline underline-offset-2" style={{ color: 'var(--muted)' }}>Not them? Scan or search again</button>
            <button type="button" onClick={() => { e.setTicketToPrint?.(item); e.setIsPrintDialogOpen?.(true); }} className="text-[13px] underline underline-offset-2" style={{ color: 'var(--muted)' }}>Print their ticket</button></div>
        </Step>

        <Step n={2} title="The visit">
          {(renter || item.renterId) && <Row k="Booked with">{renter?.businessName || renter?.name || 'A renter'} <Pill tone="accent">Renter</Pill></Row>}
          {at && <Row k="Time">{format(at, 'h:mm a')} · <span style={offset > 2 ? { color: 'var(--warn)', fontWeight: 600 } : undefined}>{arrival}</span></Row>}
          <Row k="Service">{services.join(' + ') || '—'}</Row>
          {addOns.length > 0 && <Row k="Add-ons">{addOns.join(', ')}</Row>}
          <Row k="With">{provider?.name || 'Anyone available'}</Row>
          {(item.stationName || item.resourceName) && <Row k="Station">{item.stationName || item.resourceName}</Row>}
          <Row k="Status">{awaitingDeposit ? <Pill tone="warn">Awaiting deposit</Pill> : <Pill tone="ok">{String(item.status || 'confirmed').replace(/_/g, ' ')}</Pill>}</Row>
          {!isWalkIn && <button type="button" onClick={() => { e.setSelectedAppointment(item); e.setIsDetailsOpen(true); }} className="text-[13px] underline underline-offset-2" style={{ color: 'var(--muted)' }}>Change service or time</button>}
        </Step>

        <Step n={3} title="Contact">
          <div className="grid gap-2.5 sm:grid-cols-2">{field('name', 'Name')}{field('phone', 'Mobile', 'tel')}</div>
          {field('email', 'Email', 'email')}
          <div className="flex flex-wrap items-center gap-2 text-[13px]"><span style={{ color: 'var(--muted)' }}>Visit updates by</span>
            <Seg label="Updates by" value={c.channel} onChange={(v) => setC({ ...c, channel: v })} options={[['sms', 'Text'], ['email', 'Email'], ['both', 'Both']]} />
            <select value={c.language} onChange={(ev) => setC({ ...c, language: ev.target.value })} aria-label="Language" className="h-9 rounded-full px-3 text-[13px]" style={{ background: 'var(--soft)' }}>
              {['English', 'Español', 'Français', 'Tiếng Việt', '中文', '한국어', 'Other'].map((l) => <option key={l}>{l}</option>)}</select></div>
          {changed && <div className="space-y-1.5 rounded-2xl p-3" style={{ background: 'var(--soft)' }}>
            <p className="text-[13px] font-semibold">Where should these changes go?</p>
            <div className="flex flex-wrap gap-2"><Btn quiet={saveTo !== 'profile'} onClick={() => setSaveTo('profile')}>Update their profile</Btn><Btn quiet={saveTo !== 'visit'} onClick={() => setSaveTo('visit')}>This visit only</Btn></div></div>}
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>These are for updates about their visits — nobody is signed up for marketing here.</p>
        </Step>

        <Step n={4} title="Needed for this visit">
          {formsPending ? <div className="space-y-2"><p className="text-[14px]"><Pill tone="warn">Forms not done</Pill> <span className="ml-1">They still need to finish their forms for this booking.</span></p>
            {link && <div className="flex flex-wrap gap-2"><Btn quiet onClick={() => window.open(link, '_blank', 'noopener')}>Hand them this device</Btn>
              {c.phone && <Btn quiet onClick={() => { window.location.href = `sms:${c.phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(`Hi ${first}, here's your check-in link to finish your forms: ${link}`)}`; }}>Text them the link</Btn>}
              <Btn quiet onClick={() => navigator.clipboard?.writeText(link)}>Copy link</Btn></div>}</div>
            : <p className="text-[14px]">Nothing else is needed for this booking. ✓</p>}
          <label className="block text-[13px]"><span style={{ color: 'var(--muted)' }}>Anything we should know today? (optional)</span>
            <textarea value={needs} onChange={(ev) => setNeeds(ev.target.value)} rows={2} placeholder="e.g. prefers a quiet room, needs a step stool" className="mt-1 w-full rounded-xl p-3 text-[14px] outline-none" style={{ background: 'var(--soft)' }} /></label>
          {needs.trim() && item.clientId && <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={rememberNeeds} onChange={(ev) => setRememberNeeds(ev.target.checked)} /> Remember this on their profile for next time</label>}
        </Step>

        <Step n={5} title="Payment">
          {depositPaid > 0 && <Row k="Deposit">{money(depositPaid)} paid <Pill tone="ok">✓</Pill></Row>}
          {awaitingDeposit && <Row k="Deposit"><Pill tone="warn">Not paid yet</Pill></Row>}
          {owed > 0 && <Row k="Owed from before">{money(owed)} <Pill tone="warn">Owes</Pill></Row>}
          {!depositPaid && !awaitingDeposit && !owed && <p className="text-[14px]">Nothing paid or owed yet — they’ll pay at checkout.</p>}
          {(renter || item.renterId) && <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Payment for this visit goes to {String(renter?.businessName || renter?.name || 'the renter').replace(/\.$/, '')}.</p>}
        </Step>

        <Step n={6} title="Arrival">
          <Row k="Checking in">{format(now, 'h:mm a')} · {arrival}</Row>
          <label className="block text-[13px]"><span style={{ color: 'var(--muted)' }}>Note for {provider ? provider.name.split(' ')[0] : 'the provider'} (optional)</span>
            <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="e.g. parking, needs 5 minutes" className="mt-1 h-11 w-full rounded-xl px-3 text-[14px] outline-none" style={{ background: 'var(--soft)' }} /></label>
          {provider && <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={notify} onChange={(ev) => setNotify(ev.target.checked)} /> Let {provider.name.split(' ')[0]} know they’re here</label>}
        </Step>

        {err && <p className="text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>{err}</p>}
        <div className="sticky bottom-0 -mx-5 px-5 pb-1 pt-3" style={{ background: 'var(--paper)' }}><Btn big onClick={checkIn} disabled={busy} className="w-full">{busy ? 'Checking in…' : `Check in ${first}`}</Btn></div>
      </div>
    </Drawer>
  );
}
