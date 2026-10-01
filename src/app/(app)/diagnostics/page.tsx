'use client';
// src/app/(app)/diagnostics/page.tsx — ACCOUNT CHECK (customer-facing).
// A friendly health check of this business on this device: plain-English results, a "Fix it" button where a fix is
// safe to do yourself, and "Send to support" — which opens a normal help-desk ticket with the technical findings
// attached for ClarityFlow HQ only. No raw data or code is ever shown to the customer.
import * as React from 'react';
import Link from 'next/link';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useLocation } from '@/context/LocationContext';

type Level = 'ok' | 'warn' | 'info';
interface Finding { key: string; level: Level; title: string; detail?: string; fix?: 'restore_location' | 'reset_location' | 'locations' | 'support' }
const AREAS: [string, string][] = [['locations', 'Locations'], ['appointments', 'Appointments'], ['clients', 'Clients'], ['retailOrders', 'Online orders'], ['calls', 'Calls'], ['waitlist', 'Waitlist'], ['staff', 'Team'], ['inventory', 'Products']];

async function token() { return (await getAuth().currentUser?.getIdToken().catch(() => '')) || ''; }

export default function AccountCheckPage() {
  const { firestore, user } = useFirebase() as any;
  const t: any = useTenant(); const l: any = useLocation();
  const tid = t?.selectedTenant?.id || null;
  const [owned, setOwned] = React.useState<any>(null); const [reads, setReads] = React.useState<Record<string, { ok: boolean; count?: number; code?: string }> | null>(null);
  const [waitingOrders, setWaitingOrders] = React.useState(0); const [dropped, setDropped] = React.useState(false); const [done, setDone] = React.useState(false);
  const [note, setNote] = React.useState(''); const [sent, setSent] = React.useState<string | null>(null); const [busy, setBusy] = React.useState<string | null>(null);
  const peak = React.useRef(0); const timeline = React.useRef<string[]>([]); const start = React.useRef(Date.now());
  const locCount = (l?.locations || []).length;
  // Watch the first 15 s: data that loads and then vanishes is the commonest "it's not showing" problem.
  React.useEffect(() => { const s = ((Date.now() - start.current) / 1000).toFixed(1); if (Date.now() - start.current < 15000) timeline.current = [...timeline.current, `${s}s business=${tid ? 'yes' : 'no'} role=${t?.role || '-'} locations=${locCount}`].slice(-20);
    if (locCount > peak.current) peak.current = locCount; else if (peak.current > 0 && locCount === 0 && !l?.isLoading) setDropped(true); }, [locCount, tid, t?.role, l?.isLoading]);
  React.useEffect(() => { (async () => { try { const r = await fetch('/api/my-tenants', { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' }); setOwned(r.ok ? await r.json() : { ok: false }); } catch { setOwned({ ok: false }); } })(); }, [user?.uid]);
  React.useEffect(() => { if (!firestore || !tid) return; (async () => {
    const out: Record<string, any> = {};
    for (const [c] of AREAS) { try { const s = await getDocs(query(collection(firestore, `tenants/${tid}/${c}`), limit(25))); out[c] = { ok: true, count: s.size }; } catch (e: any) { out[c] = { ok: false, code: String(e?.code || 'error') }; } }
    setReads(out);
    if (out.retailOrders?.ok) { try { const s = await getDocs(query(collection(firestore, `tenants/${tid}/retailOrders`), where('stage', '==', 'placed'), limit(50)));
      setWaitingOrders(s.docs.filter((d) => Date.now() - (Date.parse((d.data() as any).placedAt || '') || Date.now()) > 30 * 60000).length); } catch { /* optional */ } }
    setTimeout(() => setDone(true), 2500); })(); }, [!!firestore, tid]); // eslint-disable-line react-hooks/exhaustive-deps  (re-run only when the business changes)

  const findings: Finding[] = [];
  const ownsSomething = owned?.ok && ((owned.owned || []).length > 0 || owned.staff);
  if (owned && !ownsSomething) findings.push({ key: 'no_business', level: 'warn', title: 'Your login isn’t connected to a business yet', detail: 'Sign out and back in. If this stays, send this check to support and we’ll connect it.', fix: 'support' });
  else if (owned) findings.push({ key: 'business', level: 'ok', title: `Signed in to ${t?.selectedTenant?.name || 'your business'}${t?.role ? ` as ${t.role === 'owner' ? 'the owner' : t.role}` : ''}` });
  if (reads) {
    const blocked = AREAS.filter(([c]) => reads[c] && !reads[c].ok).map(([, n]) => n);
    if (blocked.length) findings.push({ key: 'access', level: 'warn', title: `Some of your information can’t load: ${blocked.join(', ')}`, detail: 'This is on our side — send this check to support and we’ll fix it.', fix: 'support' });
    else findings.push({ key: 'access', level: 'ok', title: 'All your information loads normally' });
  }
  const names = (l?.locations || []).map((x: any) => String(x.name || '').trim().toLowerCase());
  const dupes = names.length - new Set(names).size;
  if (reads?.locations?.ok && !l?.isLoading) {
    if (!locCount) findings.push({ key: 'no_location', level: 'warn', title: 'Your business has no location set up', detail: 'Bookings, booths and staff access all hang off a location.', fix: 'restore_location' });
    else if (dupes > 0) findings.push({ key: 'dupes', level: 'info', title: `You have ${dupes + 1} locations with the same name`, detail: 'Merging the copies keeps everything tidy — nothing attached to them is lost.', fix: 'locations' });
    else findings.push({ key: 'locations', level: 'ok', title: `${locCount} location${locCount === 1 ? '' : 's'} set up` });
  }
  let storedLoc: string | null = null; try { storedLoc = localStorage.getItem('selectedLocationId'); } catch { /* */ }
  if (locCount && storedLoc && !(l?.locations || []).some((x: any) => x.id === storedLoc)) findings.push({ key: 'stale_location', level: 'warn', title: 'This device remembers a location that no longer exists', fix: 'reset_location' });
  if (dropped) findings.push({ key: 'dropped', level: 'warn', title: 'Some information appeared and then disappeared', detail: 'Send this check to support — it tells us exactly what happened.', fix: 'support' });
  if (waitingOrders) findings.push({ key: 'orders_waiting', level: 'info', title: `${waitingOrders} online order${waitingOrders === 1 ? ' is' : 's are'} waiting for payment confirmation`, detail: 'We check these with Stripe automatically every few minutes — paid ones move to your orders board on their own.' });
  const issues = findings.filter((f) => f.level === 'warn').length;

  const fix = async (f: Finding) => {
    if (f.fix === 'reset_location') { try { localStorage.removeItem('selectedLocationId'); } catch { /* */ } window.location.reload(); return; }
    if (f.fix === 'restore_location') { setBusy(f.key); const r = await fetch('/api/locations/repair', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ tenantId: tid }) }).then((x) => x.json()).catch(() => null); setBusy(null);
      if (r?.ok) window.location.reload(); else window.alert(r?.error || 'That didn’t work — send this check to support.'); return; }
    if (f.fix === 'locations') { window.location.href = '/settings'; return; }
    document.getElementById('send-support')?.scrollIntoView({ behavior: 'smooth' });
  };
  const send = async () => {
    setBusy('send');
    const health = { summary: issues ? `${issues} issue${issues === 1 ? '' : 's'} found` : 'No issues found', findings: findings.map((f) => ({ key: f.key, level: f.level, text: f.title })),
      business: { tenantId: tid, role: t?.role || null, serverOwned: owned?.owned || [], staff: owned?.staff || null }, reads, locations: { count: locCount, duplicates: dupes, storedOnDevice: storedLoc }, waitingOrders, timeline: timeline.current };
    const r = await fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ action: 'create', tenantId: tid, kind: 'broken', subject: `Account check — ${health.summary}`, message: note.trim().length >= 5 ? note.trim() : `Account check sent from ${t?.selectedTenant?.name || 'my business'}.`,
        context: { page: '/diagnostics', host: window.location.host, screen: `${window.innerWidth}x${window.innerHeight}`, health } }) }).then((x) => x.json()).catch(() => null);
    setBusy(null); setSent(r?.ok ? 'Sent — our team has everything they need. You’ll see our reply under Help.' : (r?.error || 'That didn’t send — check your connection and try again.'));
  };
  const icon = (lv: Level) => (lv === 'ok' ? '✓' : lv === 'warn' ? '!' : 'i');
  const tone = (lv: Level) => (lv === 'ok' ? 'bg-emerald-100 text-emerald-800' : lv === 'warn' ? 'bg-amber-100 text-amber-900' : 'bg-stone-200 text-stone-700');
  const fixLabel: Record<string, string> = { restore_location: 'Fix it', reset_location: 'Fix it', locations: 'Review locations', support: 'Tell support' };
  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 md:p-8">
      <div><h1 className="text-3xl font-semibold tracking-tight">Account check</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">We’re checking your business’s setup on this device. It only takes a few seconds and doesn’t change anything.</p></div>
      <section className="rounded-3xl border bg-card p-5">
        <p className="text-[17px] font-semibold">{!done || !reads ? 'Checking…' : issues ? `${issues} thing${issues === 1 ? '' : 's'} need${issues === 1 ? 's' : ''} attention` : 'Everything looks good'}</p>
        <ul className="mt-3 space-y-3">
          {findings.map((f) => <li key={f.key} className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${tone(f.level)}`}>{icon(f.level)}</span>
            <div className="min-w-0 flex-1"><p className="text-[15px] font-medium">{f.title}</p>{f.detail && <p className="text-[13px] text-muted-foreground">{f.detail}</p>}</div>
            {f.fix && f.level !== 'ok' && <button type="button" disabled={busy === f.key} onClick={() => fix(f)} className="h-9 shrink-0 rounded-full border px-3 text-[13px] font-semibold disabled:opacity-50">{busy === f.key ? 'Fixing…' : fixLabel[f.fix]}</button>}
          </li>)}
          {!findings.length && <li className="text-[14px] text-muted-foreground">Checking…</li>}
        </ul>
      </section>
      <section id="send-support" className="space-y-3 rounded-3xl border bg-card p-5">
        <p className="text-[17px] font-semibold">Still having trouble?</p>
        <p className="text-[14px] text-muted-foreground">Send this check to ClarityFlow support. It includes what we found on this device, so you won’t have to explain the technical side.</p>
        <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 2000))} rows={3} placeholder="What’s going wrong? (optional)" className="w-full rounded-2xl border bg-background p-3 text-[15px] outline-none" />
        <button type="button" disabled={busy === 'send' || !tid || !!sent?.startsWith('Sent')} onClick={send} className="h-11 rounded-full bg-primary px-5 text-[14px] font-semibold text-primary-foreground disabled:opacity-50">{busy === 'send' ? 'Sending…' : 'Send to support'}</button>
        {sent && <p className="text-[14px] font-medium" role="status">{sent}</p>}
      </section>
      <p className="text-center text-[13px] text-muted-foreground"><Link href="/dashboard" className="underline underline-offset-4">Back to dashboard</Link></p>
    </div>
  );
}
