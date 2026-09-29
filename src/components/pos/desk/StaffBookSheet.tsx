'use client';
// src/components/pos/desk/StaffBookSheet.tsx — BOOKING AT THE DESK, THROUGH THE ENGINE.
// Everything the old quick-book form did that mattered, saved by the shared
// booking engine (never written from the browser):
//   client search · add a client (duplicate warning) · owes-money stop (charge, or book anyway with a reason)
//   service · add-ons · custom length · price · real open times · any time (managers may book over a clash, with a reason)
//   repeat · group · several providers · deposit (link / charge / paid / waive) · package · promo · how to meet · notes
//   save for a call-back at any point · resume one · confirmation: copy link, resend, share, print
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { DESK_CSS, Btn, Seg } from '@/components/pos/desk/kit';
import { placeOptionsOf, PLACE_LABEL } from '@/lib/service-place';
import { useClientIntelligence } from '@/hooks/useClientIntelligence';
import { ClientIntelligencePanel } from '@/components/pos/ClientIntelligencePanel';
import { unpaidFeeRuleOf, seriesDepositOf, seriesDepositDaysOf } from '@/lib/booking-policies';
import { computeDepositCents } from '@/lib/deposit-policy';
import { hasRealCard } from '@/lib/card-on-file';
import { callbackReasonsFor, callbackReason } from '@/lib/callback-reasons';

type Mode = 'one' | 'repeat' | 'group' | 'steps';
type Guest = { name: string; phone: string; serviceId: string; staffId: string };
type Step = { serviceId: string; staffId: string };

// Layout pieces live OUTSIDE the sheet so typing never remounts the inputs inside them.
const H = ({ children }: { children: React.ReactNode }) => <p className="text-[13px] font-semibold">{children}</p>;
const Chip = ({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) =>
  <button type="button" aria-pressed={on} onClick={onClick} className="rounded-full px-3 py-1.5 text-[13px] font-medium transition" style={on ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--soft)', color: 'var(--ink)' }}>{children}</button>;
const Card = ({ children }: { children: React.ReactNode }) => <section className="space-y-3 rounded-3xl p-4" style={{ background: 'var(--card)', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>{children}</section>;

async function staffJson(url: string, body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) })).catch(() => ({ status: 0, ok: false, error: 'We couldn’t reach the server — check your connection.' }));
}
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const digits = (v: string) => String(v || '').replace(/\D/g, '');
const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const addMinutes = (date: string, time: string, min: number) => new Date(new Date(`${date}T${time}:00`).getTime() + min * 60000);

export function StaffBookSheet({ open, onClose, tenantId, tenant, clients, services, staff, appointments, role, uid, resume }: {
  open: boolean; onClose: () => void; tenantId: string; tenant: any; clients: any[]; services: any[]; staff: any[];
  appointments?: any[]; role?: string | null; uid?: string | null; resume?: any | null;
}) {
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  // ── client ──
  const [q, setQ] = React.useState(''); const [client, setClient] = React.useState<any>(null);
  const [isNew, setIsNew] = React.useState(false); const [nName, setNName] = React.useState(''); const [nPhone, setNPhone] = React.useState(''); const [nEmail, setNEmail] = React.useState('');
  const [owesOk, setOwesOk] = React.useState(false); const [owesReason, setOwesReason] = React.useState(''); const [owesMsg, setOwesMsg] = React.useState<string | null>(null);
  const [owesOpen, setOwesOpen] = React.useState(false); const [owesVia, setOwesVia] = React.useState<'cash' | 'terminal' | 'other'>('cash'); const [owesBusy, setOwesBusy] = React.useState(false);
  const [allNow, setAllNow] = React.useState(false);   // repeat: take every visit's deposit now (instead of the business setting)
  // ── service ──
  const [serviceId, setServiceId] = React.useState(''); const [addOnIds, setAddOnIds] = React.useState<string[]>([]);
  const [lenAdj, setLenAdj] = React.useState(0); const [price, setPrice] = React.useState('');
  // ── when ──
  const [staffId, setStaffId] = React.useState('any'); const [date, setDate] = React.useState(todayStr()); const [time, setTime] = React.useState('');
  const [times, setTimes] = React.useState<any[] | null>(null); const [timesErr, setTimesErr] = React.useState<string | null>(null); const [ownTime, setOwnTime] = React.useState(false);
  const [clash, setClash] = React.useState<string | null>(null); const [overrideReason, setOverrideReason] = React.useState('');
  // ── extras ──
  const [mode, setMode] = React.useState<Mode>('one');
  const [every, setEvery] = React.useState('2'); const [count, setCount] = React.useState('4');
  const [groupName, setGroupName] = React.useState(''); const [guests, setGuests] = React.useState<Guest[]>([]);
  const [steps, setSteps] = React.useState<Step[]>([]);
  // ── payment & notes ──
  const [deposit, setDeposit] = React.useState<'link' | 'charge' | 'paid' | 'waive'>('link');
  const [pkg, setPkg] = React.useState(''); const [promo, setPromo] = React.useState(''); const [place, setPlace] = React.useState('');
  const [notes, setNotes] = React.useState(''); const [privateNotes, setPrivateNotes] = React.useState('');
  const [reminder, setReminder] = React.useState('');   // '' = the business's usual reminder
  // ── flow ──
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<any>(null);
  const [cbOpen, setCbOpen] = React.useState(false);
  const [cb, setCb] = React.useState({ reason: 'book', promise: 'none' as 'none' | 'pick', dueAt: '', contactBy: 'call' as 'call' | 'text' | 'email', ownerId: uid || '', promised: '', note: '', tell: true });
  const [draftId, setDraftId] = React.useState<string | null>(null);

  // Client insights (history, habits, suggestions) — from data already loaded, no extra reads.
  const intel = useClientIntelligence(client, appointments || [], services || []);

  const reset = React.useCallback(() => {
    setQ(''); setClient(null); setIsNew(false); setNName(''); setNPhone(''); setNEmail(''); setOwesOk(false); setOwesReason(''); setOwesMsg(null); setOwesOpen(false); setAllNow(false);
    setServiceId(''); setAddOnIds([]); setLenAdj(0); setPrice(''); setStaffId('any'); setDate(todayStr()); setTime(''); setTimes(null); setOwnTime(false);
    setClash(null); setOverrideReason(''); setMode('one'); setGuests([]); setSteps([]); setGroupName(''); setDeposit('link'); setPkg(''); setPromo(''); setPlace('');
    setNotes(''); setPrivateNotes(''); setReminder(''); setError(null); setDone(null); setCbOpen(false); setDraftId(null);
  }, []);

  // Resume a saved call-back (this sheet's own snapshot, or the old form's).
  React.useEffect(() => {
    if (!open) return;
    if (!resume) { reset(); return; }
    reset(); setDraftId(resume.id || null);
    const s = resume.snapshot || {};
    if (resume.snapshotKind === 'staff_book_sheet') {
      if (s.clientId) setClient(clients.find((c) => c.id === s.clientId) || null);
      if (s.isNew) { setIsNew(true); setNName(s.nName || ''); setNPhone(s.nPhone || ''); setNEmail(s.nEmail || ''); }
      setServiceId(s.serviceId || ''); setAddOnIds(s.addOnIds || []); setLenAdj(Number(s.lenAdj) || 0); setPrice(s.price || '');
      setStaffId(s.staffId || 'any'); if (s.date && s.date >= todayStr()) setDate(s.date); setTime(s.time || '');
      setMode(s.mode || 'one'); setEvery(s.every || '2'); setCount(s.count || '4'); setGuests(s.guests || []); setSteps(s.steps || []); setGroupName(s.groupName || '');
      setNotes(s.notes || ''); setPrivateNotes(s.privateNotes || ''); setPromo(s.promo || ''); setPlace(s.place || '');
    } else {
      // The old quick-book form's snapshot — carry over what maps.
      const c = resume.clientId ? clients.find((x) => x.id === resume.clientId) : null;
      if (c) setClient(c); else { setIsNew(true); setNName(resume.callerName && resume.callerName !== 'Unknown caller' ? resume.callerName : (s.newClientName || '')); setNPhone(resume.callerPhone || s.newClientPhone || ''); setNEmail(resume.callerEmail || s.newClientEmail || ''); }
      setServiceId(s.selectedService || ''); setAddOnIds(s.addOnIds || []); setStaffId(s.selectedStaff || 'any');
      if (s.aptDate && s.aptDate >= todayStr()) setDate(s.aptDate); setTime(s.aptTime || ''); setNotes(s.clientNotes || ''); setPrivateNotes(s.internalNotes || resume.note || '');
    }
    setCb((x) => ({ ...x, reason: resume.reason || 'book', contactBy: resume.contactBy || 'call', promised: resume.promised || '', note: resume.note || '', ownerId: resume.ownerId || uid || '' }));
  }, [open, resume]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── derived ──
  const bookable = React.useMemo(() => (services || []).filter((s: any) => s.isActive !== false && s.type !== 'addon' && !s.isAddon), [services]);
  const svc: any = React.useMemo(() => (services || []).find((s: any) => s.id === serviceId) || null, [services, serviceId]);
  const addOnChoices = React.useMemo(() => {
    if (!svc) return [];
    const allowed: string[] = Array.isArray(svc.compatibleAddOnIds) ? svc.compatibleAddOnIds : [];
    return (services || []).filter((s: any) => s.isActive !== false && (s.type === 'addon' || s.isAddon) && (!allowed.length || allowed.includes(s.id)));
  }, [services, svc]);
  const baseLen = (Number(svc?.duration) || 60) + addOnIds.reduce((m, id) => m + (Number((services || []).find((s: any) => s.id === id)?.duration) || 0), 0);
  const length = Math.max(5, baseLen + lenAdj);
  const qualified = React.useMemo(() => (staff || []).filter((m: any) => m.isActive !== false && m.active !== false && (!svc?.staffIds?.length || svc.staffIds.includes(m.id))), [staff, svc]);
  const matches = React.useMemo(() => {
    const t = q.trim().toLowerCase(); if (t.length < 2) return [];
    const d = digits(t);
    return (clients || []).filter((c: any) => String(c.name || '').toLowerCase().includes(t) || (d.length >= 3 && digits(c.phone).includes(d)) || String(c.email || '').toLowerCase().includes(t)).slice(0, 6);
  }, [q, clients]);
  const dupes = React.useMemo(() => {
    if (!isNew) return [];
    const p = digits(nPhone), e = nEmail.trim().toLowerCase(), n = nName.trim().toLowerCase();
    return (clients || []).filter((c: any) => (p.length >= 7 && digits(c.phone).endsWith(p.slice(-7))) || (e && String(c.email || '').toLowerCase() === e) || (n.length > 3 && String(c.name || '').toLowerCase() === n)).slice(0, 3);
  }, [isNew, nPhone, nEmail, nName, clients]);
  const owes = Number(client?.outstandingBalance) || 0;
  const owesRule = unpaidFeeRuleOf(tenant);                      // next_visit · keep_booking · before_booking
  const owesBlocks = owes > 0 && owesRule === 'before_booking' && !owesOk;
  // "Collected with the deposit": what this booking's deposit is, and the one payment it makes with the balance.
  const depCentsNow = svc ? computeDepositCents({ service: svc, price: Number(price) || Number(svc.price) || 0, tenant, depositsLive: true } as any) : 0;
  const withDeposit = owes > 0 && owesRule === 'with_deposit' && !owesOk && mode === 'one' && depCentsNow > 0 && deposit !== 'waive';
  const cardLabel = hasRealCard(client) ? `Charge ${client?.cardOnFile?.last4 ? `•••• ${client.cardOnFile.last4}` : 'their saved card'}` : null;
  const seriesPolicy = seriesDepositOf(tenant); const seriesDays = seriesDepositDaysOf(tenant);
  const packages = (Array.isArray(client?.activePackages) ? client.activePackages : []).filter((p: any) => Number(p.sessionsRemaining) > 0);
  const hasDeposit = !!svc && svc.depositType && svc.depositType !== 'none';
  const placeOpts = svc ? placeOptionsOf(svc) : [];
  const accent = tenant?.bookingPageSettings?.cfPageConfig?.accentColor || tenant?.brandColor || 'hsl(var(--primary))';

  // Real open times whenever the service, provider, day or length changes.
  React.useEffect(() => {
    if (!open || !serviceId || !date) { setTimes(null); return; }
    let live = true; setTimesErr(null); setTimes(null);
    staffJson('/api/appointments/open-times', { tenantId, serviceId, staffId, date, addOnIds, ...(lenAdj ? { durationMinutes: length } : {}) })
      .then((r: any) => { if (!live) return; if (r.ok) setTimes(r.times || []); else setTimesErr(r.error || 'Couldn’t load open times.'); });
    return () => { live = false; };
  }, [open, tenantId, serviceId, staffId, date, addOnIds.join(','), lenAdj]); // eslint-disable-line react-hooks/exhaustive-deps

  const clientBody = () => (client ? { id: client.id } : { name: nName.trim(), phone: nPhone.trim(), email: nEmail.trim() });
  const validate = (): string | null => {
    if (!client && !(isNew && nName.trim())) return 'Choose a client, or add a new one.';
    if (!client && isNew && digits(nPhone).length < 7 && !/@/.test(nEmail)) return 'Add a phone number or email for the new client.';
    if (owesBlocks) return `${client?.name?.split(' ')[0] || 'They'} owe ${money(owes)}, and your policy is to take it before booking again. Take the payment${isManager ? ', or book anyway with a reason' : ', or ask a manager'}.`;
    if (!svc) return 'Choose a service.';
    if (!time) return 'Choose a time.';
    if (mode === 'group' && !guests.length) return 'Add at least one guest, or choose “Just this one”.';
    if (mode === 'group' && guests.some((g) => !g.name.trim() || !g.serviceId)) return 'Each guest needs a name and a service.';
    if (mode === 'steps' && (!steps.length || steps.some((s) => !s.serviceId || !s.staffId))) return 'Each extra step needs a service and a provider.';
    if (clash && !overrideReason.trim()) return 'Add a reason to book over the clash, or pick another time.';
    return null;
  };
  const oneBody = (extra: any = {}) => ({
    tenantId, source: 'front-desk', serviceId, staffId, startTime: new Date(`${date}T${time}:00`).toISOString(), client: clientBody(), addOnIds,
    ...(lenAdj ? { durationMinutes: length } : {}), ...(price.trim() && Number(price) >= 0 ? { price: Number(price) } : {}),
    ...(notes.trim() ? { notes: notes.trim() } : {}),
    internalNotes: [privateNotes.trim(), owes > 0 && owesOk && owesReason.trim() ? `Booked with ${money(owes)} owed (manager) — ${owesReason.trim()}` : ''].filter(Boolean).join(' · '),
    ...(promo.trim() ? { promoCode: promo.trim() } : {}), ...(pkg ? { redeemPackageId: pkg } : {}), ...(place ? { place } : {}),
    ...(reminder ? { reminderHoursBefore: Number(reminder) } : {}),
    ...(draftId ? { callbackDraftId: draftId } : {}),
    ...(hasDeposit && deposit === 'link' ? { holdUntil: new Date(Date.now() + 24 * 3600000).toISOString() } : {}),
    ...(clash && overrideReason.trim() ? { overrideConflict: { reason: overrideReason.trim() } } : {}),
    ...extra,
  });

  const book = async () => {
    const v = validate(); if (v) { setError(v); return; }
    setBusy(true); setError(null);
    let out: any;
    if (mode === 'one') out = await staffJson('/api/appointments/book', oneBody());
    else if (mode === 'repeat') {
      const n = Math.max(2, Math.min(26, Number(count) || 2)), w = Math.max(1, Math.min(12, Number(every) || 1));
      const items = Array.from({ length: n }, (_, i) => { const st = new Date(new Date(`${date}T${time}:00`).getTime() + i * w * 7 * 864e5); const b = oneBody({ startTime: st.toISOString() }); delete (b as any).tenantId; return b; });
      out = await staffJson('/api/appointments/book-many', { tenantId, kind: 'series', items, ...(allNow ? { seriesDeposit: 'all_now' } : {}) });
      if (!out?.ok && out?.needsCard) { setBusy(false); setError(out.error); return; }
    } else if (mode === 'group') {
      const main = oneBody(); delete (main as any).tenantId;
      const items = [main, ...guests.map((g) => ({ source: 'front-desk', serviceId: g.serviceId, staffId: g.staffId || 'any', startTime: main.startTime, client: { name: g.name.trim(), phone: g.phone.trim() } }))];
      out = await staffJson('/api/appointments/book-many', { tenantId, kind: 'group', items, groupName: groupName.trim() || null });
    } else {
      const main = oneBody(); delete (main as any).tenantId;
      let at = new Date(main.startTime).getTime() + length * 60000;
      const items = [main, ...steps.map((s) => { const sv = (services || []).find((x: any) => x.id === s.serviceId); const st = new Date(at); at += (Number(sv?.duration) || 60) * 60000;
        return { source: 'front-desk', serviceId: s.serviceId, staffId: s.staffId, startTime: st.toISOString(), client: clientBody() }; })];
      out = await staffJson('/api/appointments/book-many', { tenantId, kind: 'visit', items });
    }
    if (!out?.ok) {
      setBusy(false);
      // A clash on a named provider → managers may book over it with a reason.
      if (out?.status === 409 && mode === 'one' && staffId !== 'any' && isManager && !clash) setClash(out.error || 'That time clashes with another booking.');
      setError(out?.error || 'Not booked — nothing was saved.');
      return;
    }
    // Deposit, through the desk's deposit route (single bookings; linked ones use the pay link in their messages).
    let depositNote: string | null = null;
    const firstId = out.appointmentId || out.appointments?.[0]?.appointmentId || out.results?.find((x: any) => x.ok)?.appointmentId;
    // Which bookings owe a deposit now: every visit for "all now"; otherwise just the first (the rest are covered or scheduled).
    const dueNow: string[] = mode === 'repeat' && (allNow || out.depositPolicy === 'all_now') ? (out.results || []).filter((x: any) => x.ok).map((x: any) => x.appointmentId) : firstId ? [firstId] : [];
    if (hasDeposit && deposit !== 'link' && dueNow.length) {
      const action = deposit === 'charge' ? 'charge' : deposit === 'paid' ? 'settled' : 'waive';
      let okCount = 0; let lastErr = '';
      for (const id of dueNow) { const d = await staffJson('/api/appointments/desk-deposit', { tenantId, appointmentId: id, action }); if (d?.ok) okCount++; else lastErr = d?.error || ''; }
      const what = deposit === 'charge' ? 'charged to their card' : deposit === 'paid' ? 'marked as paid' : 'waived';
      depositNote = okCount === dueNow.length ? `${dueNow.length > 1 ? `${dueNow.length} deposits` : 'Deposit'} ${what}.` : `Booked — but ${dueNow.length - okCount} deposit${dueNow.length - okCount === 1 ? '' : 's'} didn’t go through${lastErr ? `: ${lastErr}` : ''}. Take it from the booking.`;
    } else if (hasDeposit && deposit === 'link') depositNote = 'They’ve been sent a link to pay the deposit — the time is held for 24 hours.';
    if (hasDeposit && mode === 'repeat' && !(allNow || out.depositPolicy === 'all_now')) depositNote = `${depositNote ? `${depositNote} ` : ''}${out.depositPolicy === 'before_each' ? `Each later visit’s deposit is taken ${seriesDays} days before it.` : 'Later visits are held by their card on file — no more deposits.'}`;
    if (hasDeposit && (mode === 'group' || mode === 'steps')) depositNote = `${depositNote ? `${depositNote} ` : ''}One deposit covers the whole ${mode === 'group' ? 'group' : 'visit'}.`;
    setBusy(false);
    setDone({ ...out, firstId, depositNote, when: new Date(`${date}T${time}:00`), who: client?.name || nName.trim() });
  };

  // Nothing suits → the waitlist (the same list online clients join), with who, what and when they'd like.
  const joinWaitlist = async () => {
    const name = client?.name || nName.trim(); const phone = client?.phone || nPhone.trim(); const email = client?.email || nEmail.trim();
    if (!name || (!digits(phone) && !/@/.test(email))) { setError('Choose the client (or add their name and phone or email) first.'); return; }
    if (!svc) { setError('Choose a service first.'); return; }
    setBusy(true); setError(null);
    const who = staffId !== 'any' ? (staff || []).find((m: any) => m.id === staffId)?.name : null;
    const r: any = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action: 'join', source: 'front-desk', name, phone, email, serviceId,
      note: [`Wants ${new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`, who ? `with ${who}` : '', notes.trim()].filter(Boolean).join(' · ').slice(0, 200) }) })
      .then((x) => x.json()).catch(() => ({}));
    setBusy(false);
    if (!r?.ok) { setError(r?.error || 'Couldn’t add them to the waitlist.'); return; }
    setDone({ waitlist: true, already: !!r.alreadyOn, who: name });
  };

  const saveCallback = async () => {
    setBusy(true); setError(null);
    const snapshot = { clientId: client?.id || null, isNew, nName, nPhone, nEmail, serviceId, addOnIds, lenAdj, price, staffId, date, time, mode, every, count, guests, steps, groupName, notes, privateNotes, promo, place };
    const r: any = await staffJson('/api/callbacks', {
      tenantId, action: 'create', id: draftId || undefined, clientId: client?.id || null,
      callerName: client?.name || nName.trim(), callerPhone: client?.phone || nPhone.trim(), callerEmail: client?.email || nEmail.trim(),
      reason: cb.reason, timePromised: cb.promise === 'pick', dueAt: cb.promise === 'pick' && cb.dueAt ? new Date(cb.dueAt).toISOString() : undefined,
      contactBy: cb.contactBy, ownerId: cb.ownerId || null, promised: cb.promised, note: cb.note, snapshot,
    });
    if (!r?.ok) { setBusy(false); setError(r?.error || 'Couldn’t save the call-back.'); return; }
    let told = '';
    if (cb.tell) { const t: any = await staffJson('/api/callbacks', { tenantId, id: r.id, action: 'update', tellCaller: true }); if (t?.told) told = t.toldBy === 'email' ? ' — we emailed them' : ' — we texted them'; }
    setBusy(false); setDone({ callback: true, told });
  };

  if (!open) return null;
  const inp = 'h-11 w-full rounded-xl px-3.5 text-[15px] outline-none';
  const inpS = { background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)' } as React.CSSProperties;
  const visitLink = done?.checkInToken || done?.appointments?.[0]?.checkInToken ? `${window.location.origin}/check-in/${done.checkInToken || done.appointments[0].checkInToken}` : null;

  return (
    <div className="desk fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(28,25,23,.45)', ['--accent' as any]: accent, ['--accent-ink' as any]: '#fff' }} onClick={onClose}>
      <style>{DESK_CSS}</style>
      <div role="dialog" aria-modal="true" aria-label="Book an appointment" onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <header className="flex items-center justify-between gap-2 px-5 pb-3 pt-5">
          <div><p className="text-[20px] font-semibold">{done?.waitlist ? 'On the waitlist' : done?.callback ? 'Saved for a call-back' : done ? 'Booked' : resume?.fromCheckout ? 'Book the next visit' : resume ? 'Resume call-back' : 'Book'}</p>
            {!done && <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Checked and saved by the same booking system as online bookings.</p>}</div>
          <Btn quiet onClick={onClose} label="Close">Close</Btn>
        </header>

        {done ? (
          <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-6">
            {done.waitlist ? <Card><p className="text-[15px]">{done.who} {done.already ? 'was already on' : 'is on'} the waitlist for {svc?.name}. They’ll be offered a time when one opens.</p></Card>
            : done.callback ? <Card><p className="text-[15px]">It’s in <b>POS → Needs attention → Callbacks</b>{done.told}. Resume it from there to finish the booking.</p></Card> : <>
              <Card>
                <p className="text-[17px] font-semibold">{done.who || 'Client'} · {svc?.name}</p>
                <p className="text-[15px]">{done.when.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at {done.when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
                {mode === 'repeat' && <p className="text-[14px]">{done.booked} of {done.results?.length} dates booked{done.results?.some((x: any) => !x.ok) ? ` — not free: ${done.results.filter((x: any) => !x.ok).map((x: any) => new Date(x.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).join(', ')}` : ''}.</p>}
                {mode === 'group' && <p className="text-[14px]">{done.booked} guests booked together{groupName ? ` — ${groupName}` : ''}.</p>}
                {mode === 'steps' && <p className="text-[14px]">{done.booked} providers, one after another.</p>}
                {done.packageRedeemed === false && <p className="text-[14px]" style={{ color: 'var(--warn)' }}>The package had no sessions left — nothing was taken off it.</p>}
                {done.depositNote && <p className="text-[14px]">{done.depositNote}</p>}
                <p className="text-[13px]" style={{ color: 'var(--muted)' }}>They’ve been sent a confirmation with their visit link.</p>
              </Card>
              <div className="flex flex-wrap gap-2">
                {visitLink && <Btn quiet onClick={() => { navigator.clipboard?.writeText(visitLink); setError('Visit link copied.'); }}>Copy visit link</Btn>}
                {done.firstId && <Btn quiet onClick={async () => { const r = await fetch('/api/notifications/resend-confirmation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, appointmentId: done.firstId }) }).then((x) => x.json()).catch(() => ({})); setError(r?.ok !== false ? 'Confirmation sent again.' : r?.error || 'Couldn’t resend.'); }}>Resend confirmation</Btn>}
                {visitLink && typeof navigator !== 'undefined' && (navigator as any).share && <Btn quiet onClick={() => (navigator as any).share({ title: 'Your appointment', url: visitLink }).catch(() => {})}>Share</Btn>}
                <Btn quiet onClick={() => window.print()}>Print</Btn>
              </div>
            </>}
            {error && <p className="text-[14px] font-semibold">{error}</p>}
            <div className="grid grid-cols-2 gap-2"><Btn quiet big onClick={reset}>Book another</Btn><Btn big onClick={onClose}>Done</Btn></div>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-4">
              {/* ── Client ── */}
              <Card>
                <H>Client</H>
                {client ? (
                  <div className="flex items-center justify-between gap-2">
                    <div><p className="text-[15px] font-semibold">{client.name}</p><p className="text-[13px]" style={{ color: 'var(--muted)' }}>{[client.phone, client.email].filter(Boolean).join(' · ')}</p></div>
                    <Btn quiet onClick={() => { setClient(null); setOwesOk(false); setPkg(''); }}>Change</Btn>
                  </div>
                ) : isNew ? (
                  <div className="space-y-2">
                    <input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="Full name" className={inp} style={inpS} />
                    <input value={nPhone} onChange={(e) => setNPhone(e.target.value)} placeholder="Phone" inputMode="tel" className={inp} style={inpS} />
                    <input value={nEmail} onChange={(e) => setNEmail(e.target.value)} placeholder="Email" type="email" className={inp} style={inpS} />
                    {dupes.map((c: any) => <button key={c.id} type="button" onClick={() => { setClient(c); setIsNew(false); }} className="w-full rounded-2xl p-3 text-left text-[14px]" style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)' }}>Already a client? <b>Use {c.name}</b> {c.phone ? `· ${c.phone}` : ''}</button>)}
                    <button type="button" className="text-[13px] underline" onClick={() => setIsNew(false)}>Search existing clients instead</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or email" className={inp} style={inpS} autoFocus />
                    {matches.map((c: any) => <button key={c.id} type="button" onClick={() => { setClient(c); setQ(''); }} className="flex w-full items-center justify-between rounded-2xl p-3 text-left" style={{ background: 'var(--soft)' }}>
                      <span className="text-[15px] font-medium">{c.name}</span><span className="text-[13px]" style={{ color: 'var(--muted)' }}>{c.phone || c.email}</span></button>)}
                    <Btn quiet onClick={() => { setIsNew(true); setNName(q && !/\d|@/.test(q) ? q : ''); setNPhone(/\d/.test(q) ? q : ''); setNEmail(/@/.test(q) ? q : ''); }}>+ New client</Btn>
                  </div>
                )}
                {client && <ClientIntelligencePanel intel={intel} staff={staff} onActionClick={(insight: any) => {
                  if (insight?.actionData?.serviceId) { setServiceId(String(insight.actionData.serviceId)); setAddOnIds([]); setLenAdj(0); setTime(''); }
                }} />}
                {owes > 0 && !owesOk && (
                  <div className="space-y-2 rounded-2xl p-3" style={{ background: owesRule === 'before_booking' ? 'color-mix(in srgb, var(--warn) 10%, transparent)' : 'var(--soft)' }}>
                    <p className="text-[14px]"><b>{client.name.split(' ')[0]} owes {money(owes)}.</b>{' '}
                      {owesRule === 'before_booking' ? 'Your policy: it’s paid before booking again.'
                        : owesRule === 'with_deposit' ? (withDeposit ? `Your policy: it’s collected with this booking’s deposit — ${money(depCentsNow / 100)} + ${money(owes)} = ${money(depCentsNow / 100 + owes)}, in one payment. The balance part isn’t refundable.` : svc ? 'Your policy: it’s collected with the deposit — this booking has none due, so it’s added to this visit’s bill.' : 'Your policy: it’s collected with this booking’s deposit.')
                        : 'Your policy: it’s added to this visit’s bill — nothing to do now.'}</p>
                    {owesRule !== 'before_booking' && !owesOpen ? <button type="button" className="text-[13px] underline" onClick={() => setOwesOpen(true)}>Settle it now instead</button> : <>
                      <div className="flex flex-wrap gap-2">
                        {cardLabel && <Btn disabled={owesBusy} onClick={async () => { setOwesBusy(true); setOwesMsg(null); const r: any = await fetch('/api/portal/pay-balance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, clientId: client.id }) }).then((x) => x.json()).catch(() => ({})); setOwesBusy(false);
                          if (r?.ok) { setOwesOk(true); setOwesMsg(`Paid — ${money(Number(r.paidDollars) || owes)} charged${r.last4 ? ` to •••• ${r.last4}` : ''}.`); setClient({ ...client, outstandingBalance: 0 }); } else setOwesMsg('The card didn’t go through — take it another way.'); }}>{cardLabel}</Btn>}
                        <Btn quiet disabled={owesBusy} onClick={async () => { setOwesBusy(true); setOwesMsg(null); const r: any = await staffJson('/api/clients/balance', { tenantId, clientId: client.id, action: 'link' }); setOwesBusy(false);
                          setOwesMsg(r?.ok ? `Pay link sent by ${r.sentTo === 'email' ? 'email' : 'text'}.${owesRule === 'before_booking' ? ' They can be booked once it’s paid.' : ''}` : r?.error || 'The link didn’t send.'); }}>Send a pay link</Btn>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Seg label="Paid at the desk by" value={owesVia} onChange={(v) => setOwesVia(v)} options={[['cash', 'Cash'], ['terminal', 'Card terminal'], ['other', 'Other']]} />
                        <Btn quiet disabled={owesBusy} onClick={async () => { setOwesBusy(true); setOwesMsg(null); const r: any = await staffJson('/api/clients/balance', { tenantId, clientId: client.id, action: 'settled', via: owesVia }); setOwesBusy(false);
                          if (r?.ok) { setOwesOk(true); setOwesMsg(`Recorded — ${money(owes)} paid at the desk.`); setClient({ ...client, outstandingBalance: 0 }); } else setOwesMsg(r?.error || 'That didn’t save.'); }}>Paid at the desk</Btn>
                      </div>
                      {isManager && <div className="space-y-1.5">
                        <input value={owesReason} onChange={(e) => setOwesReason(e.target.value)} placeholder="Manager: reason to book anyway or waive" className={inp} style={inpS} />
                        <div className="flex flex-wrap gap-2">
                          {owesRule === 'before_booking' && <Btn quiet disabled={!owesReason.trim()} onClick={() => setOwesOk(true)}>Book anyway</Btn>}
                          <Btn quiet disabled={!owesReason.trim() || owesBusy} onClick={async () => { setOwesBusy(true); const r: any = await staffJson('/api/clients/balance', { tenantId, clientId: client.id, action: 'waive', reason: owesReason.trim() }); setOwesBusy(false);
                            if (r?.ok) { setOwesOk(true); setOwesMsg(`${money(owes)} waived.`); setClient({ ...client, outstandingBalance: 0 }); setOwesReason(''); } else setOwesMsg(r?.error || 'That didn’t save.'); }}>Waive it</Btn>
                        </div>
                      </div>}
                      {!isManager && owesRule === 'before_booking' && <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Only a manager can book them before it’s paid.</p>}
                    </>}
                    {owesMsg && <p className="text-[13px] font-semibold">{owesMsg}</p>}
                  </div>
                )}
                {owesMsg && owesOk && <p className="text-[13px] font-semibold">{owesMsg}</p>}
              </Card>

              {/* ── Service ── */}
              <Card>
                <H>Service</H>
                <select value={serviceId} onChange={(e) => { setServiceId(e.target.value); setAddOnIds([]); setLenAdj(0); setTime(''); setPlace(''); }} className={inp} style={inpS}>
                  <option value="">Choose a service</option>
                  {bookable.map((s: any) => <option key={s.id} value={s.id}>{s.name}{Number(s.price) ? ` · $${Number(s.price).toFixed(0)}` : ''}</option>)}
                </select>
                {addOnChoices.length > 0 && <div className="flex flex-wrap gap-1.5">{addOnChoices.map((a: any) => <Chip key={a.id} on={addOnIds.includes(a.id)} onClick={() => setAddOnIds((x) => (x.includes(a.id) ? x.filter((y) => y !== a.id) : [...x, a.id]))}>+ {a.name}</Chip>)}</div>}
                {svc && <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px]">Length <b>{length} min</b>{lenAdj ? <span style={{ color: 'var(--muted)' }}> (usually {baseLen})</span> : null}</span>
                  <Btn quiet onClick={() => setLenAdj((x) => Math.max(5 - baseLen, x - 15))} label="15 minutes shorter">−15</Btn>
                  <Btn quiet onClick={() => setLenAdj((x) => Math.min(600 - baseLen, x + 15))} label="15 minutes longer">+15</Btn>
                  <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} placeholder={`Price (${Number(svc.price) ? `$${Number(svc.price).toFixed(0)}` : 'usual'})`} inputMode="decimal" className="h-9 w-32 rounded-xl px-3 text-[14px] outline-none" style={inpS} />
                </div>}
                {placeOpts.length > 1 && <div className="space-y-1.5"><p className="text-[13px]" style={{ color: 'var(--muted)' }}>How they’ll meet</p><div className="flex flex-wrap gap-1.5">{placeOpts.map((k) => <Chip key={k} on={(place || placeOpts[0]) === k} onClick={() => setPlace(k)}>{PLACE_LABEL[k]}</Chip>)}</div></div>}
              </Card>

              {/* ── When ── */}
              {svc && <Card>
                <H>When</H>
                <div className="grid grid-cols-2 gap-2">
                  <select value={staffId} onChange={(e) => { setStaffId(e.target.value); setTime(''); setClash(null); }} className={inp} style={inpS}>
                    <option value="any">Anyone available</option>
                    {qualified.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input type="date" value={date} min={todayStr()} onChange={(e) => { setDate(e.target.value); setTime(''); setClash(null); }} className={inp} style={inpS} />
                </div>
                {!ownTime ? <>
                  {times === null && !timesErr && <p className="text-[14px]" style={{ color: 'var(--muted)' }}>Finding open times…</p>}
                  {timesErr && <p className="text-[14px]" style={{ color: 'var(--warn)' }}>{timesErr}</p>}
                  {times && !times.length && <p className="text-[14px]" style={{ color: 'var(--muted)' }}>No open times that day{staffId !== 'any' ? ' for this provider' : ''}. Try another day, or type a time.</p>}
                  {times && times.length > 0 && <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">{times.map((t: any) => <Chip key={t.time} on={time === t.time} onClick={() => { setTime(t.time); setClash(null); }}>{t.label}</Chip>)}</div>}
                  {time && staffId === 'any' && times?.find((t: any) => t.time === time)?.staff?.length ? <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Free then: {times.find((t: any) => t.time === time).staff.map((s: any) => String(s.name).split(' ')[0]).join(', ')}</p> : null}
                  <div className="flex flex-wrap gap-3">
                    <button type="button" className="text-[13px] underline" onClick={() => setOwnTime(true)}>Type a time instead</button>
                    <button type="button" className="text-[13px] underline" onClick={joinWaitlist}>Add to the waitlist instead</button>
                  </div>
                </> : <div className="flex items-center gap-2"><input type="time" value={time} onChange={(e) => { setTime(e.target.value); setClash(null); }} className={inp} style={inpS} /><button type="button" className="shrink-0 text-[13px] underline" onClick={() => setOwnTime(false)}>Open times</button></div>}
                {clash && <div className="space-y-2 rounded-2xl p-3" style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)' }}>
                  <p className="text-[14px]"><b>That time clashes:</b> {clash}</p>
                  <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Book anyway — reason (recorded on the booking)" className={inp} style={inpS} />
                </div>}
              </Card>}

              {/* ── Booking type ── */}
              {svc && <Card>
                <H>Booking type</H>
                <Seg label="Booking type" value={mode} onChange={(v) => { setMode(v); if ((v === 'group' || v === 'steps') && deposit === 'link') setDeposit('charge'); }} options={[['one', 'Just this one'], ['repeat', 'Repeat'], ['group', 'Group'], ['steps', 'More providers']]} />
                {mode === 'repeat' && <div className="flex flex-wrap items-center gap-2 text-[14px]">Every
                  <select value={every} onChange={(e) => setEvery(e.target.value)} className="h-9 rounded-xl px-2" style={inpS}>{['1', '2', '3', '4', '6', '8'].map((w) => <option key={w} value={w}>{w} week{w === '1' ? '' : 's'}</option>)}</select>
                  for <select value={count} onChange={(e) => setCount(e.target.value)} className="h-9 rounded-xl px-2" style={inpS}>{['2', '3', '4', '6', '8', '10', '12'].map((c) => <option key={c} value={c}>{c} visits</option>)}</select>
                  <span className="w-full text-[13px]" style={{ color: 'var(--muted)' }}>Same time and provider. Any date that isn’t free is skipped and listed. Only the first sends a confirmation.</span>
                  {hasDeposit && <span className="w-full space-y-1 text-[13px]">
                    <span className="block">{allNow || seriesPolicy === 'all_now' ? `Every visit’s deposit is taken now (${count} visits).` : seriesPolicy === 'before_each' ? `First deposit now; each later visit’s is taken ${seriesDays} days before it. Needs a card on file.` : seriesPolicy === 'none' ? 'No deposits — their card on file holds the series.' : 'First visit’s deposit now; their card on file holds the rest.'}</span>
                    {seriesPolicy !== 'all_now' && <label className="flex items-center gap-2"><input type="checkbox" checked={allNow} onChange={(e) => { setAllNow(e.target.checked); if (e.target.checked && deposit === 'link') setDeposit('charge'); }} style={{ accentColor: 'var(--accent)' }} /> Take every visit’s deposit now instead</label>}
                  </span>}</div>}
                {mode === 'group' && <div className="space-y-2">
                  <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name (optional) — e.g. Ana’s bridal party" className={inp} style={inpS} />
                  {guests.map((g, i) => <div key={i} className="space-y-1.5 rounded-2xl p-3" style={{ background: 'var(--soft)' }}>
                    <div className="grid grid-cols-2 gap-1.5"><input value={g.name} onChange={(e) => setGuests((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} placeholder="Guest name" className="h-10 rounded-xl px-3 text-[14px] outline-none" style={inpS} />
                      <input value={g.phone} onChange={(e) => setGuests((x) => x.map((y, j) => (j === i ? { ...y, phone: e.target.value } : y)))} placeholder="Phone (optional)" className="h-10 rounded-xl px-3 text-[14px] outline-none" style={inpS} /></div>
                    <div className="grid grid-cols-2 gap-1.5"><select value={g.serviceId} onChange={(e) => setGuests((x) => x.map((y, j) => (j === i ? { ...y, serviceId: e.target.value } : y)))} className="h-10 rounded-xl px-2 text-[14px]" style={inpS}><option value="">Service</option>{bookable.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                      <select value={g.staffId} onChange={(e) => setGuests((x) => x.map((y, j) => (j === i ? { ...y, staffId: e.target.value } : y)))} className="h-10 rounded-xl px-2 text-[14px]" style={inpS}><option value="any">Anyone available</option>{(staff || []).filter((m: any) => m.isActive !== false).map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
                    <button type="button" className="text-[13px] underline" onClick={() => setGuests((x) => x.filter((_, j) => j !== i))}>Remove guest</button>
                  </div>)}
                  <Btn quiet onClick={() => setGuests((x) => [...x, { name: '', phone: '', serviceId: serviceId, staffId: 'any' }])}>+ Add a guest</Btn>
                  <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Everyone starts at the same time. All or nothing: if anyone can’t be booked, nobody is.</p>
                </div>}
                {mode === 'steps' && <div className="space-y-2">
                  {steps.map((s, i) => <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
                    <select value={s.serviceId} onChange={(e) => setSteps((x) => x.map((y, j) => (j === i ? { ...y, serviceId: e.target.value } : y)))} className="h-10 rounded-xl px-2 text-[14px]" style={inpS}><option value="">Then…</option>{bookable.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
                    <select value={s.staffId} onChange={(e) => setSteps((x) => x.map((y, j) => (j === i ? { ...y, staffId: e.target.value } : y)))} className="h-10 rounded-xl px-2 text-[14px]" style={inpS}><option value="">With…</option>{(staff || []).filter((m: any) => m.isActive !== false).map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                    <button type="button" aria-label="Remove step" className="px-2 text-[18px]" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}>×</button></div>)}
                  <Btn quiet onClick={() => setSteps((x) => [...x, { serviceId: '', staffId: '' }])}>+ Add a step</Btn>
                  <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Each step starts when the one before it ends. All or nothing — one confirmation for the whole visit.</p>
                </div>}
              </Card>}

              {/* ── Payment & notes ── */}
              {svc && <Card>
                <H>Payment &amp; notes</H>
                {hasDeposit && <><p className="text-[13px]" style={{ color: 'var(--muted)' }}>This service takes a deposit.</p>
                  <Seg label="Deposit" value={deposit} onChange={(v) => setDeposit(v)} options={[
                    ...((mode === 'group' || mode === 'steps' || (mode === 'repeat' && (allNow || seriesPolicy === 'all_now'))) ? [] : [['link', 'Send a pay link'] as ['link', string]]),
                    ['charge', 'Charge card on file'], ['paid', 'Paid at the desk'], ...(isManager ? [['waive', 'Waive'] as ['waive', string]] : [])]} /></>}
                {owes > 0 && owesRule === 'with_deposit' && deposit === 'waive' && <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Waiving the deposit doesn’t waive their {money(owes)} balance — it stays on their account.</p>}
                {packages.length > 0 && <select value={pkg} onChange={(e) => setPkg(e.target.value)} className={inp} style={inpS}>
                  <option value="">Don’t use a package</option>
                  {packages.map((p: any) => <option key={p.packageId} value={p.packageId}>Use {p.name || p.packageName || 'package'} — {p.sessionsRemaining} left</option>)}
                </select>}
                <input value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} placeholder="Promo code (optional)" className={inp} style={inpS} />
                <select value={reminder} onChange={(e) => setReminder(e.target.value)} className={inp} style={inpS} aria-label="Reminder">
                  <option value="">{client?.notificationPreferences?.reminderHoursBefore ? `Reminder: their preference (${client.notificationPreferences.reminderHoursBefore} hours before)` : 'Reminder: your usual timing'}</option>
                  <option value="1">Reminder 1 hour before</option><option value="2">Reminder 2 hours before</option>
                  <option value="24">Reminder 24 hours before</option><option value="48">Reminder 48 hours before</option>
                </select>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Note for the booking (the client can see this)" className="w-full resize-none rounded-xl px-3.5 py-2.5 text-[15px] outline-none" style={inpS} />
                <textarea value={privateNotes} onChange={(e) => setPrivateNotes(e.target.value)} rows={2} placeholder="Private note (team only)" className="w-full resize-none rounded-xl px-3.5 py-2.5 text-[15px] outline-none" style={inpS} />
              </Card>}

              {/* ── Save for a call-back ── */}
              {cbOpen && <Card>
                <H>Save for a call-back</H>
                <div className="flex flex-wrap gap-1.5">{callbackReasonsFor(tenant).map((r) => <Chip key={r.id} on={cb.reason === r.id} onClick={() => setCb((x) => ({ ...x, reason: r.id }))}>{r.label}</Chip>)}</div>
                <textarea value={cb.note} onChange={(e) => setCb((x) => ({ ...x, note: e.target.value }))} rows={2} placeholder="What do they need?" className="w-full resize-none rounded-xl px-3.5 py-2.5 text-[15px] outline-none" style={inpS} />
                <select value={cb.ownerId} onChange={(e) => setCb((x) => ({ ...x, ownerId: e.target.value }))} className={inp} style={inpS}>
                  <option value="">Anyone at the desk</option>{(staff || []).filter((m: any) => m.isActive !== false).map((m: any) => <option key={m.id} value={m.id}>{m.id === uid ? `Me (${String(m.name || '').split(' ')[0]})` : m.name}</option>)}
                </select>
                <Seg label="Promise a time?" value={cb.promise} onChange={(v) => setCb((x) => ({ ...x, promise: v }))} options={[['none', 'No set time'], ['pick', 'A set time']]} />
                {cb.promise === 'pick' ? <input type="datetime-local" value={cb.dueAt} onChange={(e) => setCb((x) => ({ ...x, dueAt: e.target.value }))} className={inp} style={inpS} />
                  : <p className="text-[13px]" style={{ color: 'var(--muted)' }}>We’ll say we’ll get back to them as soon as we can.{callbackReason(cb.reason).urgent ? ' It goes to the top of the list.' : ''}</p>}
                <Seg label="How to reach them" value={cb.contactBy} onChange={(v) => setCb((x) => ({ ...x, contactBy: v }))} options={[['call', 'Call'], ['text', 'Text'], ['email', 'Email']]} />
                <input value={cb.promised} onChange={(e) => setCb((x) => ({ ...x, promised: e.target.value }))} placeholder="What you told them (optional)" className={inp} style={inpS} />
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={cb.tell} onChange={(e) => setCb((x) => ({ ...x, tell: e.target.checked }))} style={{ accentColor: 'var(--accent)' }} /> Let them know when to expect us</label>
                <div className="grid grid-cols-2 gap-2"><Btn quiet onClick={() => setCbOpen(false)}>Back to booking</Btn><Btn onClick={saveCallback} disabled={busy}>{busy ? 'Saving…' : 'Save call-back'}</Btn></div>
              </Card>}
            </div>

            <footer className="space-y-2 border-t px-5 pb-5 pt-3" style={{ borderColor: 'var(--line)' }}>
              {error && <p role="alert" className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }}>{error}</p>}
              {!cbOpen && <div className="grid grid-cols-[auto_1fr] gap-2">
                <Btn quiet big onClick={() => { setCbOpen(true); setError(null); }}>Save for a call-back</Btn>
                <Btn big onClick={book} disabled={busy}>{busy ? 'Booking…' : mode === 'repeat' ? `Book ${count} visits` : mode === 'group' ? `Book ${guests.length + 1} guests` : mode === 'steps' ? `Book ${steps.length + 1} steps` : 'Book'}</Btn>
              </div>}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
