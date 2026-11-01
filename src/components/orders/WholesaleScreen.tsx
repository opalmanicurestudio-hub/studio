'use client';
// src/components/orders/WholesaleScreen.tsx — WHOLESALE: applications to look at, and buyers. Each buyer opens one sheet
// (business, contact, discount, notes, their orders, their code, and their sales tax: they pay it, or they buy tax free
// with a resale certificate for each state, only with their own emails). Applications from the shop are approved,
// which makes the buyer and emails their code, or declined. Settings holds taking applications, the apply link and the
// house code. Managers only (a code is money off); every change is made by the server (api/retail/wholesale), and the
// tax rules are lib/wholesale-tax.
import * as React from 'react';
import Link from 'next/link';
import { collection, doc, getDocs, limit, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { fileAsDataUrl, wholesale } from '@/lib/wholesale-client';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { STATE_LIST, buyerTaxLabel, dayLabel, readCerts, stateCode, stateName, taxSettingOf, type Cert } from '@/lib/wholesale-tax';
import { Btn, C, Empty, Ic, Initials, LargeTitle, Sheet, Toggle, UndoBar, feel, muted } from './ui';

type Buyer = { id: string; [k: string]: any };
type App = { id: string; [k: string]: any };
type Stats = { count: number; cents: number; last: string; recent: { id: string; num: number; at: string; cents: number }[]; emails: string[] };
const money = (c: number) => `$${(Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const money2 = (c: number) => `$${(c / 100).toFixed(2)}`;
const shortDay = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) }) : ''; };
const applied = (iso: string) => {
  const d = new Date(iso); if (!Number.isFinite(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 864e5);
  return days < 1 && d.getDate() === new Date().getDate() ? 'applied today' : days < 2 ? 'applied yesterday' : `applied ${shortDay(iso)}`;
};
const KIND: Record<string, string> = { salon: 'Salon', spa: 'Spa', shop: 'Shop', other: 'Other' };
const first = (n: string) => String(n || '').trim().split(' ')[0] || 'them';
const pill = (warn: boolean): React.CSSProperties => (warn ? { background: C.warnSoft, color: C.warn } : { background: C.soft, color: C.ink });
const field = 'mt-1 block h-12 w-full rounded-2xl border px-4 text-[16px] font-normal';
const fieldStyle: React.CSSProperties = { borderColor: C.line, background: C.paper, color: C.ink };

export function WholesaleScreen() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant, role } = useTenant() as any;
  const tenantId = String(selectedTenant?.id || '');
  // The shop's own day (as checkout decides an end date), not this device's.
  const t0 = selectedTenant ? todayIn(tenantTimeZone(selectedTenant)) : new Date().toLocaleDateString('en-CA');
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [buyers, setBuyers] = React.useState<Buyer[] | null>(null);
  const [pending, setPending] = React.useState<App[]>([]);
  const [rs, setRs] = React.useState<any>({});
  const [stats, setStats] = React.useState<Record<string, Stats>>({});
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState<Buyer | 'new' | null>(null);
  const [app, setApp] = React.useState<App | null>(null);
  const [settings, setSettings] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const [denied, setDenied] = React.useState(false);

  React.useEffect(() => {
    if (!fs || !tenantId || !isManager) return;
    const u1 = onSnapshot(collection(fs, `tenants/${tenantId}/wholesaleAccounts`), (s) => setBuyers(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))), () => { setBuyers([]); setDenied(true); });
    const u2 = onSnapshot(query(collection(fs, `tenants/${tenantId}/wholesaleApplications`), where('status', '==', 'pending'), limit(300)), (s) => setPending(s.docs.map((d) => ({ ...(d.data() as any), id: d.id })).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))), () => setPending([]));
    const u3 = onSnapshot(doc(fs, `tenants/${tenantId}`), (s) => setRs((s.data() as any)?.retailSettings || {}), () => {});
    // Each buyer's paid orders, for their count, total and latest (one read; the list doesn't need it live).
    getDocs(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('priceTier', '==', 'wholesale'), limit(2000))).then((s) => {
      const by: Record<string, Stats> = {};
      for (const d of s.docs) {
        const o: any = d.data(); const id = String(o.wholesaleAccountId || '');
        if (!id || !(Number(o.orderNumber) > 0) || o.stage === 'cancelled') continue;
        const at = String(o.paidAt || o.placedAt || '');
        const cents = Math.max(0, (Number(o.totalCents) || 0) - (Number(o.refundedCents) || 0));
        const st = (by[id] ||= { count: 0, cents: 0, last: '', recent: [], emails: [] });
        const em = String(o.customerEmail || '').trim().toLowerCase(); if (em && !st.emails.includes(em)) st.emails.push(em);
        st.count += 1; st.cents += cents; if (at > st.last) st.last = at;
        st.recent.push({ id: d.id, num: Number(o.orderNumber) || 0, at, cents });
      }
      for (const st of Object.values(by)) st.recent = st.recent.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
      setStats(by);
    }).catch(() => {});
    return () => { u1(); u2(); u3(); };
  }, [fs, tenantId, isManager]);

  const shown = React.useMemo(() => {
    const n = q.trim().toLowerCase();
    const xs = (buyers || []).filter((b) => !n || [b.businessName, b.contactName, b.email, b.accessCode].some((v) => String(v || '').toLowerCase().includes(n)));
    return xs.sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || String(a.businessName || '').localeCompare(String(b.businessName || '')));
  }, [buyers, q]);
  const byEmail = React.useMemo(() => new Map((buyers || []).filter((b) => b.email).map((b) => [String(b.email).toLowerCase(), b])), [buyers]);
  const active = (buyers || []).filter((b) => b.status === 'active').length;

  if (!isManager || denied) return (
    <div className="mx-auto max-w-3xl px-4 pb-32 pt-5 lg:px-8" style={{ color: C.ink }}>
      <Link href="/retail-orders/setup" className="cf-press inline-flex h-11 items-center gap-1 text-[15px]" style={muted}>{Ic.back} Setup</Link>
      <LargeTitle title="Wholesale" />
      <Empty title="Wholesale is for managers" sub="A buyer’s code is money off, so only managers see buyers and their codes." />
    </div>);

  const done = (m: string, ok = true) => { feel(ok); setToast(m); };
  return (
    <div className="mx-auto max-w-5xl px-4 pb-32 pt-5 lg:px-8" style={{ color: C.ink }}>
      <Link href="/retail-orders/setup" className="cf-press inline-flex h-11 items-center gap-1 text-[15px]" style={muted}>{Ic.back} Setup</Link>
      <LargeTitle title="Wholesale"
        sub={buyers === null ? 'Loading…' : `${active} ${active === 1 ? 'buyer' : 'buyers'}${pending.length ? ` · ${pending.length} ${pending.length === 1 ? 'application' : 'applications'} to look at` : ''}`}
        right={<div className="hidden gap-2 sm:flex"><Btn onClick={() => setSettings(true)}>Settings</Btn><Btn kind="primary" onClick={() => setOpen('new')}>Add a buyer</Btn></div>} />
      <div className="mt-3 flex gap-2 sm:hidden"><Btn className="flex-1" onClick={() => setSettings(true)}>Settings</Btn><Btn kind="primary" className="flex-1" onClick={() => setOpen('new')}>Add a buyer</Btn></div>

      <label className="mt-4 flex h-12 items-center gap-2 rounded-full border px-4" style={{ borderColor: C.line, color: C.muted }}>
        {Ic.search}<input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search buyers" placeholder="Search buyers" className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none" style={{ color: C.ink }} />
      </label>

      {pending.length > 0 && (
        <section className="mt-5 rounded-[20px] border px-4 py-3" style={{ borderColor: C.line }}>
          <p className="m-0 text-[13px] font-semibold" style={muted}>Applications to look at</p>
          {pending.map((a, i) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 py-3" style={i ? { borderTop: `1px solid ${C.line}` } : undefined}>
              <Initials name={a.businessName} />
              <div className="min-w-[200px] flex-1">
                <p className="m-0 text-[16px] font-semibold">{a.businessName}</p>
                <p className="m-0 text-[14px]" style={muted}>{[a.contactName, KIND[a.kind] || '', stateName(a.state || ''), applied(a.createdAt)].filter(Boolean).join(' · ')}</p>
              </div>
              {byEmail.get(String(a.email || '').toLowerCase()) ? <span className="rounded-full px-2.5 py-1 text-[13px] font-semibold" style={pill(true)}>Already a buyer</span>
                : a.certNumber || a.certFileUrl ? <span className="rounded-full px-2.5 py-1 text-[13px] font-semibold" style={{ background: C.okSoft, color: C.ok }}>{stateName(a.state || '')} certificate added</span>
                : <span className="rounded-full px-2.5 py-1 text-[13px] font-semibold" style={pill(false)}>No certificate</span>}
              <Btn className="h-11" onClick={() => setApp(a)}>Look at it</Btn>
            </div>))}
        </section>)}

      <section className="mt-5">
        <p className="m-0 pb-1 text-[13px] font-semibold" style={muted}>Buyers</p>
        {buyers === null ? null : !buyers.length ? (
          <Empty title="No buyers yet" sub={rs.wholesaleApplyOpen ? 'Applications from your shop show up here.' : 'Add a business, or take applications from your shop in Settings.'} />
        ) : !shown.length ? <Empty title="No buyer matches that" /> : shown.map((b) => {
          const st = stats[b.id]; const tax = buyerTaxLabel(b, rs, t0); const paused = b.status !== 'active';
          return (
            <button key={b.id} type="button" onClick={() => setOpen(b)} className="cf-press flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-t px-1 py-3.5 text-left" style={{ borderColor: C.line, color: paused ? C.muted : C.ink }}>
              <Initials name={b.businessName} />
              <span className="min-w-[180px] flex-[1_1_240px]">
                <span className="block text-[16px] font-semibold">{b.businessName}</span>
                <span className="block text-[14px]" style={muted}>{paused ? `Paused${b.pausedAt ? ` ${shortDay(b.pausedAt)}` : ''} · their code doesn’t work` : [b.contactName, st ? `${st.count} ${st.count === 1 ? 'order' : 'orders'} · ${money(st.cents)}` : 'No orders yet'].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="flex flex-[1_1_260px] flex-wrap gap-1.5">
                {paused ? <span className="rounded-full px-2.5 py-1 text-[13px] font-semibold" style={{ background: C.soft, color: C.muted }}>Paused</span> : <>
                  {Number(b.extraDiscountPercent) > 0 && <span className="rounded-full px-2.5 py-1 text-[13px] font-semibold" style={pill(false)}>{b.extraDiscountPercent}% extra off</span>}
                  <span className="rounded-full px-2.5 py-1 text-[13px] font-semibold" style={pill(tax.warn)}>{tax.label}</span></>}
              </span>
              <span className="text-right sm:w-[110px]"><span className="block text-[15px]">{st?.last ? shortDay(st.last) : '—'}</span><span className="block text-[13px]" style={muted}>last order</span></span>
            </button>);
        })}
      </section>

      {open && <BuyerSheet tenantId={tenantId} day={t0} buyer={open === 'new' ? null : (buyers || []).find((b) => b.id === open.id) || open} rs={rs} stats={open === 'new' ? undefined : stats[open.id]}
        onClose={() => setOpen(null)} onDone={(m) => { done(m); }} />}
      {app && <ApplicationSheet tenantId={tenantId} app={app} already={byEmail.get(String(app.email || '').toLowerCase()) || null} onClose={() => setApp(null)} onDone={(m, ok) => { done(m, ok); if (ok) setApp(null); }} />}
      {settings && <SettingsSheet tenantId={tenantId} rs={rs} isOwner={['owner', 'admin'].includes(String(role || '').toLowerCase())} onClose={() => setSettings(false)} onDone={(m, ok) => done(m, ok)} />}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={24} />}
    </div>);
}

type CertDraft = Cert & { open?: boolean; busy?: boolean; err?: string };

function BuyerSheet({ tenantId, day, buyer, rs, stats, onClose, onDone }: { tenantId: string; day: string; buyer: Buyer | null; rs: any; stats?: Stats; onClose: () => void; onDone: (m: string) => void }) {
  const b = buyer || ({} as any);
  const setting = buyer ? taxSettingOf(b, rs) : { setting: 'taxable' as const, legacy: false };
  const [f, setF] = React.useState({ businessName: b.businessName || '', contactName: b.contactName || '', email: b.email || '', phone: b.phone || '', notes: b.notes || '', extraDiscountPercent: Number(b.extraDiscountPercent) || 0 });
  const [tax, setTax] = React.useState<'exempt' | 'taxable'>(setting.setting);
  const [certs, setCerts] = React.useState<CertDraft[]>(() => readCerts(b.certs));
  const [emails, setEmails] = React.useState<string[]>(Array.isArray(b.taxEmails) ? b.taxEmails : []);
  const [addEmail, setAddEmail] = React.useState('');
  const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState(''); const [note, setNote] = React.useState('');
  const [sureCode, setSureCode] = React.useState(false);
  // The buyer as it was when this sheet opened: a save over someone else's change since is turned back by the server.
  const seenAt = React.useRef<string>(String(b.updatedAt || b.createdAt || ''));
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));
  const certSet = (i: number, patch: Partial<CertDraft>) => setCerts((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const save = async () => {
    setBusy('save'); setErr('');
    const typed = addEmail.trim().toLowerCase();
    const r = await wholesale(tenantId, 'save', { buyer: { ...f, id: buyer?.id, ...(buyer ? { seenAt: seenAt.current } : {}), tax, taxEmails: typed ? [...emails, typed] : emails, certs: certs.map(({ open: _o, busy: _b, err: _e, ...c }) => c) } });
    setBusy('');
    if (!r.ok) { feel(false); setErr(r.message); return; }
    onDone(r.message); onClose();
  };
  // Steps inside the sheet say how they went inside it (the page's bar is behind the sheet).
  const step = async (action: string, args: any = {}) => {
    setBusy(action); setErr(''); setNote('');
    const r = await wholesale(tenantId, action, { id: buyer?.id, ...args });
    setBusy(''); setSureCode(false);
    if (!r.ok) { feel(false); setErr(r.message); return; }
    feel(true); if (r.updatedAt) seenAt.current = String(r.updatedAt);
    if (action === 'status') { onDone(r.message); onClose(); } else setNote(r.message);
  };
  const upload = async (i: number, file: File | undefined) => {
    if (!file) return;
    certSet(i, { busy: true, err: '' });
    try {
      const data = await fileAsDataUrl(file);
      const r = await wholesale(tenantId, 'upload', { file: data, name: file.name, for: buyer?.id || 'new' });
      certSet(i, r.ok ? { busy: false, fileUrl: r.url, fileName: r.name } : { busy: false, err: r.message });
    } catch (e: any) { certSet(i, { busy: false, err: String(e?.message || 'That file couldn’t be read.') }); }
  };
  const paused = !!buyer && b.status !== 'active';
  const sub = buyer ? [b.createdAt ? `A buyer since ${new Date(b.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : '', stats ? `${stats.count} ${stats.count === 1 ? 'order' : 'orders'} · ${money(stats.cents)}` : 'No orders yet'].filter(Boolean).join(' · ') : 'Their code is made when you save. Email it to them from here after.';
  return (
    <Sheet title={buyer ? b.businessName || 'Buyer' : 'Add a buyer'} sub={sub} onClose={onClose} wide>
      {buyer && <div className="mt-1 flex justify-end"><Btn className="h-11" disabled={!!busy} onClick={() => void step('status', { status: paused ? 'active' : 'suspended' })}>{paused ? 'Turn them back on' : 'Pause this buyer'}</Btn></div>}
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] font-semibold" style={muted}>Business name<input value={f.businessName} onChange={(e) => set('businessName', e.target.value.slice(0, 120))} className={field} style={fieldStyle} /></label>
        <label className="block text-[13px] font-semibold" style={muted}>Contact<input value={f.contactName} onChange={(e) => set('contactName', e.target.value.slice(0, 80))} className={field} style={fieldStyle} /></label>
        <label className="block text-[13px] font-semibold" style={muted}>Email<input type="email" inputMode="email" value={f.email} onChange={(e) => set('email', e.target.value.slice(0, 160))} className={field} style={fieldStyle} /></label>
        <label className="block text-[13px] font-semibold" style={muted}>Phone<input inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value.slice(0, 30))} className={field} style={fieldStyle} /></label>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div><p className="m-0 text-[16px]">Extra off wholesale prices</p><p className="m-0 text-[13px]" style={muted}>On top of each product’s wholesale price, up to 50%</p></div>
        <div role="group" aria-label="Extra off" className="inline-flex h-11 items-center rounded-full border" style={{ borderColor: C.line }}>
          <button type="button" aria-label="Less" onClick={() => set('extraDiscountPercent', Math.max(0, f.extraDiscountPercent - 5))} className="cf-press h-11 w-11 text-[18px]">−</button>
          <span className="min-w-[48px] text-center text-[15px]">{f.extraDiscountPercent}%</span>
          <button type="button" aria-label="More" onClick={() => set('extraDiscountPercent', Math.min(50, f.extraDiscountPercent + 5))} className="cf-press h-11 w-11 text-[18px]">+</button>
        </div>
      </div>

      <fieldset className="mt-4 border-0 border-t p-0 pt-3" style={{ borderColor: C.line }}>
        <legend className="sr-only">Sales tax</legend>
        <p className="m-0 text-[13px] font-semibold" style={muted}>Sales tax</p>
        {(['taxable', 'exempt'] as const).map((v) => (
          <label key={v} className="flex min-h-[44px] items-center gap-3 text-[16px]">
            <input type="radio" name="tax" checked={tax === v} onChange={() => setTax(v)} className="h-5 w-5" style={{ accentColor: C.ink }} />
            {v === 'taxable' ? 'They pay sales tax' : 'Tax free, with their resale certificate'}
          </label>))}
        {tax === 'exempt' && (
          <div className="pl-8">
            {setting.legacy && !certs.length && <p className="m-0 mb-2 rounded-2xl px-3.5 py-2.5 text-[14px]" style={{ background: C.warnSoft, color: C.warn }}>Tax free from your old shop-wide setting, with no certificate on file. Add theirs.</p>}
            {certs.map((c, i) => c.open ? (
              <div key={c.id || i} className="mb-2 rounded-2xl border p-3" style={{ borderColor: C.line }}>
                <div className="grid gap-2 sm:grid-cols-[1.3fr_1fr_1fr]">
                  <label className="block text-[13px] font-semibold" style={muted}>Certificate number<input value={c.number} onChange={(e) => certSet(i, { number: e.target.value.slice(0, 40) })} className={field} style={fieldStyle} /></label>
                  <label className="block text-[13px] font-semibold" style={muted}>State
                    <select value={c.state} onChange={(e) => certSet(i, { state: e.target.value })} className={field} style={fieldStyle}>
                      <option value="">Choose</option>{STATE_LIST.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                    </select></label>
                  <label className="block text-[13px] font-semibold" style={muted}>Ends
                    <select value={c.endsOn === null ? 'none' : 'date'} onChange={(e) => certSet(i, { endsOn: e.target.value === 'none' ? null : (c.endsOn || '') })} className={field} style={fieldStyle}>
                      <option value="none">No end date</option><option value="date">On a date</option>
                    </select></label>
                </div>
                {c.endsOn !== null && <label className="mt-2 block text-[13px] font-semibold" style={muted}>End date<input type="date" value={c.endsOn || ''} onChange={(e) => certSet(i, { endsOn: e.target.value })} className={field} style={fieldStyle} /></label>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {c.fileUrl ? <a href={c.fileUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center text-[15px] font-semibold underline underline-offset-4">View {c.fileName || 'the copy'}</a> : <span className="text-[14px]" style={muted}>No copy yet</span>}
                  <label className="cf-press inline-flex h-11 cursor-pointer items-center rounded-full px-4 text-[15px] font-semibold" style={{ background: C.soft }}>
                    {c.busy ? 'Adding…' : c.fileUrl ? 'Replace the copy' : 'Add a copy'}
                    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(e) => void upload(i, e.target.files?.[0])} />
                  </label>
                  <button type="button" onClick={() => setCerts((cs) => cs.filter((_, j) => j !== i))} className="cf-press h-11 px-2 text-[15px] font-semibold" style={muted}>Take it off</button>
                </div>
                {c.err && <p role="alert" className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>{c.err}</p>}
              </div>) : (
              <div key={c.id || i} className="mb-2 flex flex-wrap items-center gap-3 rounded-2xl border px-3 py-2.5" style={{ borderColor: C.line }}>
                <div className="min-w-[180px] flex-1">
                  <p className="m-0 text-[15px] font-semibold">{stateName(c.state)} · <span className="tabular-nums">{c.number}</span></p>
                  <p className="m-0 text-[13px]" style={c.endsOn && c.endsOn < day ? { color: C.warn } : muted}>{c.endsOn ? `${c.endsOn < day ? 'Ended' : 'Ends'} ${dayLabel(c.endsOn)}` : 'No end date'}{c.acceptedBy ? ` · accepted by ${c.acceptedBy}${c.acceptedAt ? `, ${shortDay(c.acceptedAt)}` : ''}` : ''}</p>
                </div>
                {c.fileUrl && <a href={c.fileUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center text-[15px] font-semibold underline underline-offset-4">View the copy</a>}
                <Btn className="h-11" onClick={() => certSet(i, { open: true })}>Change</Btn>
              </div>))}
            <Btn className="h-11" onClick={() => setCerts((cs) => [...cs, { id: '', state: '', number: '', endsOn: null, open: true }])}>{certs.length ? 'Add a certificate for another state' : 'Add their certificate'}</Btn>
            <p className="m-0 mt-4 text-[13px] font-semibold" style={muted}>Who can buy tax free</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {f.email.trim() ? <span className="inline-flex h-10 items-center rounded-full px-3.5 text-[14px]" style={{ background: C.soft }}>{f.email.trim().toLowerCase()}</span> : null}
              {emails.map((e) => <span key={e} className="inline-flex h-11 items-center gap-1 rounded-full pl-3.5 pr-0.5 text-[14px]" style={{ background: C.soft }}>{e}<button type="button" aria-label={`Take off ${e}`} onClick={() => setEmails((xs) => xs.filter((x) => x !== e))} className="cf-press h-11 w-11 rounded-full text-[16px]" style={muted}>×</button></span>)}
              <input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value.slice(0, 160))} onKeyDown={(e) => { if (e.key === 'Enter' && addEmail.trim()) { e.preventDefault(); setEmails((xs) => [...new Set([...xs, addEmail.trim().toLowerCase()])]); setAddEmail(''); } }} aria-label="Add an email" placeholder="Add an email for their staff" className="h-11 min-w-[220px] flex-1 rounded-full border px-4 text-[16px]" style={fieldStyle} />
            </div>
            {(() => {
              // The emails their orders were placed with that aren't on the list yet: one tap adds one.
              const listed = new Set([f.email.trim().toLowerCase(), ...emails]);
              const more = (stats?.emails || []).filter((e) => !listed.has(e)).slice(0, 4);
              return more.length ? <div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="text-[13px]" style={muted}>They’ve ordered with:</span>{more.map((e) => <button key={e} type="button" onClick={() => setEmails((xs) => [...new Set([...xs, e])])} className="cf-press inline-flex h-11 items-center rounded-full border px-3.5 text-[14px]" style={{ borderColor: C.line }}>Add {e}</button>)}</div> : null;
            })()}
            <p className="m-0 mt-2 text-[13px] leading-snug" style={muted}>An order is tax free only when it’s placed with one of these emails, signed in on your shop (the link in their code email does it), and taxed in a state they have a current certificate for. Anyone else with their code still gets wholesale prices, and pays tax.</p>
          </div>)}
      </fieldset>

      <label className="mt-4 block border-t pt-3 text-[13px] font-semibold" style={{ ...muted, borderColor: C.line }}>Notes for the team
        <textarea value={f.notes} onChange={(e) => set('notes', e.target.value.slice(0, 1000))} rows={2} className="mt-1 block w-full resize-y rounded-2xl border px-4 py-3 text-[16px] font-normal" style={fieldStyle} />
      </label>

      {buyer && (
        <div className="mt-4 border-t pt-3" style={{ borderColor: C.line }}>
          <p className="m-0 text-[13px] font-semibold" style={muted}>Their code</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="flex-1 text-[18px] font-semibold tabular-nums tracking-[0.04em]">{b.accessCode}</span>
            <Btn className="h-11" disabled={!!busy || !b.email || paused} onClick={() => void step('emailCode')}>{busy === 'emailCode' ? 'Sending…' : `Email it to ${first(b.contactName || b.businessName)}`}</Btn>
            <Btn className="h-11" disabled={!!busy} onClick={() => (sureCode ? void step('newCode') : setSureCode(true))}>{sureCode ? 'Tap again: the old code stops' : 'Make a new code'}</Btn>
          </div>
          <p className="m-0 mt-1 text-[13px]" style={muted}>A new code stops the old one at once.{b.lastUsedAt ? ` Last used ${shortDay(b.lastUsedAt)}.` : ' Not used yet.'}</p>
        </div>)}

      {stats && stats.recent.length > 0 && (
        <div className="mt-4 border-t pt-3" style={{ borderColor: C.line }}>
          <p className="m-0 text-[13px] font-semibold" style={muted}>Their orders</p>
          {stats.recent.map((o) => <Link key={o.id} href={`/retail-orders?order=${o.id}`} className="cf-press flex min-h-[44px] items-center justify-between gap-3 text-[15px]"><span>Order {o.num} · {shortDay(o.at)}</span><span className="tabular-nums">{money2(o.cents)}</span></Link>)}
          {stats.count > stats.recent.length && <p className="m-0 text-[13px]" style={muted}>And {stats.count - stats.recent.length} before these.</p>}
        </div>)}

      {note && <p role="status" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.okSoft, color: C.ok }}>{note}</p>}
      {err && <p role="alert" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
      <div className="mt-4 flex gap-2"><Btn kind="primary" className="flex-1 text-[17px]" disabled={!!busy || f.businessName.trim().length < 2} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : buyer ? 'Save' : 'Add the buyer'}</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </Sheet>);
}

function ApplicationSheet({ tenantId, app, already, onClose, onDone }: { tenantId: string; app: App; already: Buyer | null; onClose: () => void; onDone: (m: string, ok: boolean) => void }) {
  const [pct, setPct] = React.useState(0); const [other, setOther] = React.useState(false);
  const [tax, setTax] = React.useState<'exempt' | 'taxable'>(app.certNumber ? 'exempt' : 'taxable');
  const [cert, setCert] = React.useState({ state: stateCode(app.state) || '', number: String(app.certNumber || ''), endsOn: null as string | null });
  const [declining, setDeclining] = React.useState(false); const [note, setNote] = React.useState(''); const [tell, setTell] = React.useState(false);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  // A tax-free approval needs a copy on file and the team's word that they checked it.
  const [checked, setChecked] = React.useState(false);
  const [copy, setCopy] = React.useState<{ url: string; name: string } | null>(null); const [copyBusy, setCopyBusy] = React.useState(false);
  const addCopy = async (file: File | undefined) => {
    if (!file) return; setCopyBusy(true); setErr('');
    try { const r = await wholesale(tenantId, 'upload', { file: await fileAsDataUrl(file), name: file.name, for: app.id }); if (r.ok) setCopy({ url: r.url, name: r.name }); else setErr(r.message); }
    catch (e: any) { setErr(String(e?.message || 'That file couldn’t be read.')); } finally { setCopyBusy(false); }
  };
  const hasCopy = !!copy || !!app.certFileUrl;
  const go = async (action: 'approve' | 'decline') => {
    setBusy(true); setErr('');
    const r = await wholesale(tenantId, action, action === 'approve' ? { appId: app.id, extraDiscountPercent: pct, tax, cert: { ...cert, ...(copy ? { fileUrl: copy.url, fileName: copy.name } : {}) } } : { appId: app.id, note, email: tell });
    setBusy(false);
    if (!r.ok) { feel(false); setErr(r.message); return; }
    onDone(r.message, true);
  };
  const rows: [string, React.ReactNode][] = [
    ['Contact', app.contactName], ['Email', app.email], ['Phone', app.phone], ['Business', [KIND[app.kind] || '', stateName(app.state || '')].filter(Boolean).join(' · ')],
    ['Online', app.website], ['Certificate', app.certNumber || app.certFileUrl ? <>{app.certNumber ? <span className="tabular-nums">{app.certNumber}</span> : 'No number'}{` · ${stateName(app.state || '')}`}{app.certFileUrl ? <> · <a href={app.certFileUrl} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4">View the copy</a></> : null}</> : 'None sent'],
    ['Their note', app.note],
  ];
  return (
    <Sheet title={`${app.businessName} wants to buy wholesale`} sub={`${applied(app.createdAt).replace(/^a/, 'A')} from your shop`} onClose={onClose} wide>
      {already && <p className="m-0 mt-2 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{already.businessName} already buys wholesale with this email. Approving makes a second buyer.</p>}
      <div className="mt-2 grid gap-6 sm:grid-cols-2">
        <dl className="m-0">
          {rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="grid grid-cols-[110px_1fr] gap-2 border-t py-2.5 text-[15px]" style={{ borderColor: C.line }}><dt className="text-[13px] font-semibold" style={muted}>{k}</dt><dd className="m-0 break-words">{v}</dd></div>)}
        </dl>
        {!declining ? (
          <div>
            <p className="m-0 text-[13px] font-semibold" style={muted}>If you approve</p>
            <p className="m-0 mt-2 text-[16px]">Extra off wholesale prices</p>
            <div role="group" aria-label="Extra off wholesale prices" className="mt-1 flex flex-wrap gap-1.5">
              {[0, 5, 10, 15].map((v) => <button key={v} type="button" aria-pressed={!other && pct === v} onClick={() => { setOther(false); setPct(v); }} className="cf-press h-11 rounded-full px-4 text-[15px] font-semibold" style={!other && pct === v ? { background: C.ink, color: C.paper } : { background: C.soft, color: C.ink }}>{v ? `${v}%` : 'None'}</button>)}
              <button type="button" aria-pressed={other} onClick={() => setOther(true)} className="cf-press h-11 rounded-full px-4 text-[15px] font-semibold" style={other ? { background: C.ink, color: C.paper } : { background: C.soft, color: C.ink }}>Other</button>
              {other && <input inputMode="numeric" aria-label="Percent off" value={String(pct)} onChange={(e) => setPct(Math.min(50, Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0)))} className="h-11 w-20 rounded-full border px-3 text-center text-[16px]" style={fieldStyle} />}
            </div>
            <fieldset className="mt-3 border-0 p-0"><legend className="text-[16px]">Sales tax</legend>
              <label className="flex min-h-[44px] items-center gap-3 text-[16px]"><input type="radio" name="atax" checked={tax === 'exempt'} onChange={() => setTax('exempt')} className="h-5 w-5" style={{ accentColor: C.ink }} />Tax free, with the certificate they sent</label>
              {tax === 'exempt' && <div className="pl-8">
                <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr]">
                  <label className="block text-[13px] font-semibold" style={muted}>Number<input value={cert.number} onChange={(e) => setCert((c) => ({ ...c, number: e.target.value.slice(0, 40) }))} className={field} style={fieldStyle} /></label>
                  <label className="block text-[13px] font-semibold" style={muted}>State<select value={cert.state} onChange={(e) => setCert((c) => ({ ...c, state: e.target.value }))} className={field} style={fieldStyle}><option value="">Choose</option>{STATE_LIST.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
                </div>
                <label className="mt-2 block text-[13px] font-semibold" style={muted}>Ends (leave empty for no end date)<input type="date" value={cert.endsOn || ''} onChange={(e) => setCert((c) => ({ ...c, endsOn: e.target.value || null }))} className={field} style={fieldStyle} /></label>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {copy ? <a href={copy.url} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center text-[15px] font-semibold underline underline-offset-4">View {copy.name}</a> : app.certFileUrl ? <span className="text-[14px]" style={muted}>Their copy is on file</span> : <span className="text-[14px]" style={{ color: C.warn }}>No copy sent</span>}
                  <label className="cf-press inline-flex h-11 cursor-pointer items-center rounded-full px-4 text-[15px] font-semibold" style={{ background: C.soft }}>
                    {copyBusy ? 'Adding…' : hasCopy ? 'Use a different copy' : 'Add a copy'}
                    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(e) => void addCopy(e.target.files?.[0])} />
                  </label>
                </div>
                <label className="mt-2 flex min-h-[44px] items-start gap-3 text-[15px]"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" style={{ accentColor: C.ink }} />I checked the certificate: it’s theirs, filled in, and for this state</label>
                <p className="m-0 mt-2 text-[13px] leading-snug" style={muted}>Tax free when ordered with {app.email}, signed in{cert.state ? `, in ${stateName(cert.state)}` : ''}. You can add their staff’s emails after.</p>
              </div>}
              <label className="flex min-h-[44px] items-center gap-3 text-[16px]"><input type="radio" name="atax" checked={tax === 'taxable'} onChange={() => setTax('taxable')} className="h-5 w-5" style={{ accentColor: C.ink }} />They pay sales tax</label>
            </fieldset>
            <p className="m-0 mt-2 text-[13px] leading-snug" style={muted}>You keep the certificate on file for every tax-free sale.</p>
            <div className="mt-3 rounded-2xl px-4 py-3" style={{ background: C.soft }}><p className="m-0 text-[15px] font-semibold">{first(app.contactName)} gets their code by email</p><p className="m-0 text-[13px]" style={muted}>With a link to your shop. It works as soon as you approve.</p></div>
          </div>) : (
          <div>
            <p className="m-0 text-[13px] font-semibold" style={muted}>Decline</p>
            <label className="mt-2 flex min-h-[44px] items-center gap-3 text-[16px]"><input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} className="h-5 w-5" style={{ accentColor: C.ink }} />Email {first(app.contactName)} to say no</label>
            {tell && <label className="mt-2 block text-[13px] font-semibold" style={muted}>A note in the email (optional)<textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={3} placeholder="For example: we only sell wholesale to licensed salons in Texas" className="mt-1 block w-full resize-y rounded-2xl border px-4 py-3 text-[16px] font-normal" style={fieldStyle} /></label>}
            <p className="m-0 mt-2 text-[13px]" style={muted}>{tell ? 'They get a short email saying no.' : 'Nothing is sent to them.'} They can apply again later.</p>
          </div>)}
      </div>
      {err && <p role="alert" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
      <div className="mt-4 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: C.line }}>
        {!declining ? <>
          <Btn kind="primary" className="basis-full text-[17px] sm:basis-0 sm:flex-1" disabled={busy || copyBusy || (tax === 'exempt' && (!cert.state || cert.number.trim().length < 3 || !hasCopy || !checked))} onClick={() => void go('approve')}>{busy ? 'Approving…' : 'Approve and email their code'}</Btn>
          <Btn className="flex-1 sm:flex-none" disabled={busy} onClick={() => setDeclining(true)}>Decline</Btn><Btn className="flex-1 sm:flex-none" onClick={onClose}>Not now</Btn>
        </> : <>
          <Btn kind="primary" className="basis-full text-[17px] sm:basis-0 sm:flex-1" disabled={busy} onClick={() => void go('decline')}>{busy ? 'Declining…' : tell ? 'Decline and email them' : 'Decline'}</Btn>
          <Btn className="flex-1 sm:flex-none" disabled={busy} onClick={() => setDeclining(false)}>Back</Btn>
        </>}
      </div>
    </Sheet>);
}

function SettingsSheet({ tenantId, rs, isOwner, onClose, onDone }: { tenantId: string; rs: any; isOwner: boolean; onClose: () => void; onDone: (m: string, ok: boolean) => void }) {
  const [code, setCode] = React.useState(''); const [saved, setSaved] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState(''); const [copied, setCopied] = React.useState(false);
  const link = typeof window !== 'undefined' ? `${window.location.origin}/shop/${tenantId}/wholesale` : '';
  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/retail/secrets?tenantId=${encodeURIComponent(tenantId)}`, { headers: await staffAuthHeader() });
        const d = await r.json().catch(() => ({})); if (r.ok) { setCode(d.wholesaleAccessCode || ''); setSaved(d.wholesaleAccessCode || ''); }
      } catch { /* stays empty */ }
    })();
  }, [tenantId]);
  const setting = async (patch: Record<string, boolean>) => {
    setBusy(Object.keys(patch)[0]); setErr('');
    const r = await wholesale(tenantId, 'settings', patch);
    setBusy(''); if (!r.ok) { setErr(r.message); feel(false); } else feel(true);
  };
  const saveCode = async (v: string) => {
    setBusy('code'); setErr('');
    try {
      const r = await fetch('/api/retail/secrets', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, wholesaleAccessCode: v.trim().toUpperCase() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || 'That didn’t save.'); feel(false); return; }
      setSaved(d.wholesaleAccessCode || ''); setCode(d.wholesaleAccessCode || '');
      onDone(v.trim() ? 'House code saved.' : 'The house code is off.', true);
    } catch { setErr('That didn’t reach the shop’s server. Try again.'); } finally { setBusy(''); }
  };
  return (
    <Sheet title="Wholesale settings" onClose={onClose} closeLabel="Done">
      <div className="mt-2 flex items-center justify-between gap-3">
        <div><p className="m-0 text-[16px]">Take applications from your shop</p><p className="m-0 text-[13px]" style={muted}>Adds “Apply for wholesale” to your shop. Each one waits here for you.</p></div>
        <Toggle label="Take applications from your shop" on={rs.wholesaleApplyOpen === true} disabled={busy === 'applyOpen'} onChange={(v) => void setting({ applyOpen: v })} />
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-2xl py-1.5 pl-4 pr-1.5" style={{ background: C.soft }}>
        <span className="min-w-0 flex-1 truncate text-[14px]">{link}</span>
        <Btn className="h-11" style={{ background: C.paper }} onClick={() => { navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => {}); }}>{copied ? 'Copied' : 'Copy'}</Btn>
      </div>
      <p className="m-0 mt-1 text-[13px]" style={muted}>Put the link in your bio or in an email to salons you sell to.</p>

      <div className="mt-5 border-t pt-4" style={{ borderColor: C.line }}>
        <p className="m-0 text-[13px] font-semibold" style={muted}>House code</p>
        <p className="m-0 mt-1 text-[14px]" style={muted}>One code for anyone you give it to, without an account of their own. It gets wholesale prices.</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="block min-w-[180px] flex-1 text-[13px] font-semibold" style={muted}>Code<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 40))} autoComplete="off" placeholder="None" className={`${field} tracking-[0.04em]`} style={fieldStyle} /></label>
          <Btn className="h-12" disabled={busy === 'code' || saved === null || code.trim() === (saved || '')} onClick={() => void saveCode(code)}>{busy === 'code' ? 'Saving…' : 'Save'}</Btn>
          {saved ? <Btn className="h-12" disabled={busy === 'code'} onClick={() => void saveCode('')}>Turn it off</Btn> : null}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div><p className="m-0 text-[16px]">Its orders are tax free</p><p className="m-0 text-[13px]" style={muted}>No certificate is kept for these. Anyone with the code buys tax free.{isOwner ? '' : ' Only the owner or an admin can change this.'}</p></div>
          <Toggle label="House code orders are tax free" on={rs.wholesaleTaxExempt === true} disabled={busy === 'houseTaxFree' || !isOwner} onChange={(v) => void setting({ houseTaxFree: v })} />
        </div>
        <p className="m-0 mt-3 rounded-2xl px-4 py-3 text-[14px] font-semibold" style={{ background: C.warnSoft, color: C.warn }}>For tax-free buying, give each business its own account with their certificate.</p>
      </div>
      {err && <p role="alert" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
    </Sheet>);
}
