'use client';
// src/components/reviews/ReviewsScreen.tsx — ONE REVIEWS SCREEN (mockups 9A and 9B; the rules are lib/reviews). Shop
// reviews and visit reviews, each Waiting, Shown or Hidden. Show and Hide go through the server (/api/reviews) for the
// people whose role runs marketing; hiding asks why and keeps the reason, because hiding a review for being low misleads
// shoppers (the FTC's rule on consumer reviews). Beside the list, how new reviews arrive and, for the shop, the email that
// asks for one after pickup or delivery. It replaces Reputation and the shop's Product reviews page.
import * as React from 'react';
import Link from 'next/link';
import { collection, limit, onSnapshot, orderBy, query, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { moduleEnabled } from '@/lib/modules';
import { settingsOf as mirSettings } from '@/lib/making-it-right';
import { privacyOf } from '@/lib/health-privacy';
import { hasTimeZone } from '@/lib/tenant-time';
import {
  ASK_DAYS, HIDE_REASONS, askWhenWords, hideReasonShort, reviewSettings, stateOf,
  type HideReason, type ReviewKind, type ReviewSettings, type ReviewState,
} from '@/lib/reviews';
import { Btn, C, LargeTitle, Seg, Toggle, muted } from '@/components/orders/ui';

type Row = {
  kind: ReviewKind; id: string; rating: number; title: string; body: string; who: string; state: ReviewState; reason: string;
  at: string; productName?: string; productId?: string; orderId?: string; orderNumber?: string;
  staffId?: string; service?: string; clientId?: string; caseId?: string; pinned?: boolean; edited?: string; hiddenAt?: string;
};
type Filter = 'waiting' | 'shown' | 'hidden' | 'all';

const STAR = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z';
export function Stars({ n, size = 16 }: { n: number; size?: number }) {
  return (
    <span role="img" aria-label={`${n} out of 5 stars`} className="inline-flex gap-[2px] align-middle">
      {[1, 2, 3, 4, 5].map((i) => <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={STAR} fill={i <= n ? '#16171a' : '#d9dadd'} /></svg>)}
    </span>);
}

const day = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
const box: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 18, background: C.paper };
const linkCls = 'font-semibold underline underline-offset-[3px]';

function shopRow(id: string, r: any): Row {
  return { kind: 'shop', id, rating: Math.max(1, Math.min(5, Math.round(Number(r.rating) || 0))), title: String(r.title || ''), body: String(r.body || ''),
    who: String(r.author || 'Verified buyer'), state: stateOf('shop', r), reason: String(r.hiddenReason || ''), at: String(r.createdAt || ''), hiddenAt: String(r.hiddenAt || ''),
    productName: String(r.productName || ''), productId: String(r.listingId || r.productId || ''), orderId: String(r.orderId || ''),
    orderNumber: r.orderNumber != null ? String(r.orderNumber).padStart(4, '0') : '', edited: String(r.editedAt || '') };
}
function visitRow(id: string, r: any): Row {
  const name = String(r.clientName || 'A client').trim();
  return { kind: 'visit', id, rating: Math.max(1, Math.min(5, Math.round(Number(r.rating) || 0))), title: '', body: String(r.text || ''),
    who: name, state: stateOf('visit', r), reason: String(r.hiddenReason || ''), at: String(r.createdAt || ''),
    staffId: String(r.staffId || ''), service: String(r.serviceName || ''), clientId: String(r.clientId || ''), caseId: String(r.caseId || ''), pinned: r.isFeatured === true };
}

const LIMIT = 300;
/** Both kinds of review, live, newest first (the newest 300 of each). */
function useReviews(firestore: any, tenantId: string) {
  const [shop, setShop] = React.useState<Row[] | null>(null);
  const [visit, setVisit] = React.useState<Row[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    setShop(null); setVisit(null); setFailed(false);
    const fail = () => setFailed(true);
    const a = onSnapshot(query(collection(firestore as Firestore, `tenants/${tenantId}/retailReviews`), orderBy('createdAt', 'desc'), limit(LIMIT)),
      (s: any) => setShop(s.docs.map((d: any) => shopRow(d.id, d.data() || {}))), () => { setShop([]); fail(); });
    const b = onSnapshot(query(collection(firestore as Firestore, `tenants/${tenantId}/reviews`), orderBy('createdAt', 'desc'), limit(LIMIT)),
      (s: any) => setVisit(s.docs.map((d: any) => visitRow(d.id, d.data() || {}))), () => { setVisit([]); fail(); });
    return () => { a(); b(); };
  }, [firestore, tenantId]);
  return { shop, visit, failed };
}

async function post(body: any) {
  try {
    const r = await fetch('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify(body) });
    return await r.json().catch(() => ({ ok: false, error: 'That didn’t save. Try again.' }));
  } catch { return { ok: false, error: 'No connection. Try again.' }; }
}

export function ReviewsScreen() {
  const { firestore } = useFirebase();
  const tenantCtx: any = useTenant();
  const tenant: any = tenantCtx.selectedTenant;
  const tenantId = String(tenant?.id || '');
  const canEdit = typeof tenantCtx.can === 'function' ? !!tenantCtx.can('marketing.manage') : false;
  const hasShop = moduleEnabled(tenant, 'retail');
  const { staff } = useInventory() as any;
  const staffName = React.useMemo(() => { const m = new Map<string, string>(); for (const s of Array.isArray(staff) ? staff : []) m.set(String(s.id), String(s.preferredName || s.name || '').split(/\s+/)[0]); return m; }, [staff]);
  const { shop, visit, failed } = useReviews(firestore, tenantId);

  const [tab, setTabState] = React.useState<ReviewKind | null>(null);
  const [filter, setFilter] = React.useState<Filter | null>(null);
  const [pick, setPick] = React.useState('');
  const [hiding, setHiding] = React.useState<{ id: string; reason: HideReason | '' } | null>(null);
  const [busy, setBusy] = React.useState('');
  const [rowErr, setRowErr] = React.useState<{ id: string; text: string } | null>(null);
  const [S, setS] = React.useState<ReviewSettings>(() => reviewSettings(tenant));
  const [saving, setSaving] = React.useState(false);
  const [said, setSaid] = React.useState<{ text: string; bad?: boolean } | null>(null);
  // Kept in step with the business record, except while changes are still saving (they'd flash back).
  const pending = React.useRef(0);
  React.useEffect(() => { if (!pending.current) setS(reviewSettings(tenant)); }, [tenant]);

  // Which tab: the one in the link, else the one with reviews waiting, else the one with more.
  React.useEffect(() => {
    if (tab || !shop || !visit) return;
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null;
    if (q === 'shop' && hasShop) { setTabState('shop'); return; }
    if (q === 'visits') { setTabState('visit'); return; }
    const w = (rs: Row[]) => rs.filter((r) => r.state === 'waiting').length;
    setTabState(!hasShop ? 'visit' : w(shop) !== w(visit) ? (w(shop) > w(visit) ? 'shop' : 'visit') : shop.length >= visit.length ? 'shop' : 'visit');
  }, [tab, shop, visit, hasShop]);
  const setTab = (k: ReviewKind) => {
    setTabState(k); setFilter(null); setPick(''); setHiding(null); setRowErr(null);
    try { const u = new URL(window.location.href); u.searchParams.set('tab', k === 'shop' ? 'shop' : 'visits'); window.history.replaceState(null, '', u.toString()); } catch { /* the tab still changes */ }
  };

  const rows = tab === 'shop' ? shop : tab === 'visit' ? visit : null;
  const counts = React.useMemo(() => {
    const rs = rows || []; const shown = rs.filter((r) => r.state === 'shown');
    return { waiting: rs.filter((r) => r.state === 'waiting').length, shown: shown.length, hidden: rs.filter((r) => r.state === 'hidden').length, all: rs.length,
      avg: shown.length ? Math.round((shown.reduce((s, r) => s + r.rating, 0) / shown.length) * 10) / 10 : 0 };
  }, [rows]);
  const f: Filter = filter || (counts.waiting ? 'waiting' : 'all');
  const choices = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows || []) {
      if (r.kind === 'shop' && r.productName) m.set(r.productName, r.productName);
      if (r.kind === 'visit' && r.staffId) m.set(r.staffId, staffName.get(r.staffId) || 'Team member');
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows, staffName]);
  const shown = (rows || []).filter((r) => (f === 'all' || r.state === f) && (!pick || (r.kind === 'shop' ? r.productName === pick : r.staffId === pick)));
  const star = mirSettings(tenant).reviews.maxStars;

  // Where keyboard focus goes when the hide form opens and closes, or a row leaves the list.
  const listRef = React.useRef<HTMLDivElement>(null);
  const focusSoon = (fn: () => HTMLElement | null | undefined) => setTimeout(() => { try { fn()?.focus(); } catch { /* fine */ } }, 30);
  const openHide = (r: Row) => { setHiding({ id: r.id, reason: '' }); setRowErr(null); focusSoon(() => document.querySelector<HTMLInputElement>(`input[name="why-${r.id}"]`)); };
  const closeHide = (r: Row) => { setHiding(null); focusSoon(() => document.getElementById(`hide-${r.kind}-${r.id}`)); };
  const act = async (r: Row, to: 'shown' | 'hidden', reason?: HideReason) => {
    if (busy) return;
    setBusy(r.id); setRowErr(null);
    const res = await post({ tenantId, action: to === 'shown' ? 'show' : 'hide', kind: r.kind, id: r.id, reason });
    setBusy('');
    if (!res?.ok) { setRowErr({ id: r.id, text: res?.error || 'That didn’t save. Try again.' }); return; }
    if (to === 'hidden') setHiding(null);
    focusSoon(() => listRef.current);
  };
  const pin = async (r: Row, on: boolean) => {
    if (busy) return;
    setBusy(r.id); setRowErr(null);
    const res = await post({ tenantId, action: 'pin', id: r.id, on });
    setBusy('');
    if (!res?.ok) setRowErr({ id: r.id, text: res?.error || 'That didn’t save. Try again.' });
  };
  // Each change shows at once and saves in turn, so a quick second change isn't lost; one that fails is put back.
  const chain = React.useRef<Promise<void>>(Promise.resolve());
  const saved = React.useRef<ReviewSettings>(S);
  React.useEffect(() => { saved.current = reviewSettings(tenant); }, [tenant]);
  const saveSettings = (patch: { shopAutoShow?: boolean; visitAutoShow?: boolean; askOn?: boolean; askDays?: number }) => {
    if (!canEdit) return;
    setS((cur) => ({ ...cur, ...(patch.shopAutoShow !== undefined ? { shopAutoShow: patch.shopAutoShow } : {}), ...(patch.visitAutoShow !== undefined ? { visitAutoShow: patch.visitAutoShow } : {}),
      ask: { ...cur.ask, ...(patch.askOn !== undefined ? { on: patch.askOn } : {}), ...(patch.askDays !== undefined ? { days: patch.askDays } : {}) } }));
    setSaid(null); pending.current++;
    const mine: Promise<void> = chain.current.then(async () => {
      setSaving(true);
      const res = await post({ tenantId, action: 'settings', ...patch });
      setSaving(false);
      pending.current--;
      // A change that didn't save keeps its message, even if a later one did.
      if (res?.ok && res.settings) { saved.current = res.settings; setSaid((cur) => (cur?.bad ? cur : { text: 'Saved' })); }
      else setSaid({ text: res?.error || 'That didn’t save, so it’s back as it was. Try again.', bad: true });
      // Once the last change in line has its answer: what was saved (a change that failed goes back to it).
      if (chain.current === mine) setS(saved.current);
    });
    chain.current = mine;
  };

  if (!tenantId) return null;
  const loading = !rows;
  const discreet = privacyOf(tenant).discreet;
  const thanksOff = tenant?.clientNotify?.followUp === false;
  const noZone = !hasTimeZone(tenant);
  const now = Date.now();
  const waitedDays = (r: Row) => Math.floor((now - (Date.parse(r.edited || r.at) || now)) / 864e5);
  const longWaits = (rows || []).filter((r) => r.state === 'waiting' && waitedDays(r) >= 7).length;

  const settingsCol = tab === 'shop' ? (
    <>
      <section className="space-y-2 p-4" style={box}>
        <p className="m-0 text-[13px] font-semibold" style={muted}>New shop reviews</p>
        <fieldset className="m-0 space-y-1 border-0 p-0" disabled={!canEdit} aria-busy={saving}>
          <legend className="sr-only">New shop reviews</legend>
          {[{ v: true, l: 'Show right away' }, { v: false, l: 'Wait for me to show them' }].map((o) => (
            <label key={String(o.v)} className="flex min-h-11 items-center gap-2.5 text-[15px]">
              <input type="radio" name="shop-new" checked={S.shopAutoShow === o.v} onChange={() => void saveSettings({ shopAutoShow: o.v })} className="h-5 w-5" style={{ accentColor: '#16171a' }} />{o.l}
            </label>))}
        </fieldset>
      </section>
      <section className="space-y-3 p-4" style={box}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1"><p className="m-0 text-[15px] font-semibold">Ask for a review</p><p className="m-0 mt-0.5 text-[13px]" style={muted}>One email per order</p></div>
          <Toggle on={S.ask.on} label="Ask for a review" disabled={!canEdit} onChange={(v) => void saveSettings({ askOn: v })} />
        </div>
        <label className="flex flex-col gap-1.5 text-[13.5px]" style={muted}>When
          <select value={S.ask.days} disabled={!canEdit} onChange={(e) => void saveSettings({ askDays: Number(e.target.value) })}
            className="h-11 rounded-xl border px-3 text-[15px]" style={{ borderColor: C.line, background: C.paper, color: C.ink }}>
            {ASK_DAYS.map((d) => <option key={d} value={d}>{askWhenWords(d)} pickup or delivery</option>)}
          </select>
        </label>
        <p className="m-0 text-[13px] leading-snug" style={muted}>Everyone who received their order is asked, not only happy customers. If they’ve reported a problem or started a return, the ask waits until it’s settled. Shipped orders are asked once the carrier says delivered.</p>
        <p className="m-0 text-[13px] leading-snug" style={muted}>Never for a canceled order, and never to someone who unsubscribed. Turning it on asks about orders received from then on.</p>
        {discreet && <p className="m-0 rounded-xl p-3 text-[13px] leading-snug" style={{ background: C.warnSoft, color: C.warn }}>Review emails aren’t sent while discreet messages are on, so nothing about what someone bought reaches their inbox.</p>}
        {!discreet && noZone && S.ask.on && <p className="m-0 rounded-xl p-3 text-[13px] leading-snug" style={{ background: C.warnSoft, color: C.warn }}>Your business time zone isn’t set, so review emails aren’t sent: they’d land at night. Set it in <Link href="/settings" className={linkCls}>Settings</Link>, under Time zone.</p>}
      </section>
      <section className="space-y-1.5 p-4" style={box}>
        <p className="m-0 text-[13px] font-semibold" style={muted}>Hiding a review</p>
        <p className="m-0 text-[13.5px] leading-snug">Hide one only when it breaks your rules: personal details, abuse, spam, or not about the product. Hiding reviews because they’re low misleads shoppers, and the FTC treats it as review suppression.</p>
      </section>
      <section className="space-y-1.5 p-4" style={box}>
        <p className="m-0 text-[13px] font-semibold" style={muted}>Google</p>
        <p className="m-0 text-[13.5px] leading-snug">Low Google reviews go to the desk as a follow-up. <Link href="/settings/making-it-right" className={linkCls}>Making it right</Link></p>
      </section>
    </>
  ) : (
    <>
      <section className="space-y-2 p-4" style={box}>
        <p className="m-0 text-[13px] font-semibold" style={muted}>New visit reviews</p>
        <fieldset className="m-0 space-y-1 border-0 p-0" disabled={!canEdit} aria-busy={saving}>
          <legend className="sr-only">New visit reviews</legend>
          {[{ v: true, l: 'Show right away' }, { v: false, l: 'Wait for me to show them' }].map((o) => (
            <label key={String(o.v)} className="flex min-h-11 items-center gap-2.5 text-[15px]">
              <input type="radio" name="visit-new" checked={S.visitAutoShow === o.v} onChange={() => void saveSettings({ visitAutoShow: o.v })} className="h-5 w-5" style={{ accentColor: '#16171a' }} />{o.l}
            </label>))}
        </fieldset>
        <p className="m-0 text-[13px] leading-snug" style={muted}>Shown reviews appear in your booking page’s Reviews section.</p>
      </section>
      <section className="space-y-1.5 p-4" style={box}>
        <p className="m-0 text-[13px] font-semibold" style={muted}>Asking</p>
        <p className="m-0 text-[13.5px] leading-snug">{thanksOff ? 'Your thank-you message is off, so clients aren’t asked right now.' : 'Clients are asked the day after their visit, in your thank-you message.'} <Link href="/settings/messages" className={linkCls}>Client messages</Link></p>
      </section>
      <section className="space-y-1.5 p-4" style={box}>
        <p className="m-0 text-[13px] font-semibold" style={muted}>Hiding a review</p>
        <p className="m-0 text-[13.5px] leading-snug">Hide one only when it breaks your rules: personal details, abuse, spam, or not about the visit. Hiding reviews because they’re low misleads clients, and the FTC treats it as review suppression.</p>
      </section>
    </>
  );

  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-6xl px-4 pt-5">
        <LargeTitle title="Reviews" sub={canEdit ? 'What customers say, and which reviews show.' : 'Only people whose role runs marketing can change what shows.'}
          right={hasShop ? <div className="w-[15rem] max-sm:hidden"><Seg value={tab || 'shop'} onChange={(v) => setTab(v)} options={[{ id: 'shop', label: `Shop${shop ? ` · ${shop.length}` : ''}` }, { id: 'visit', label: `Visits${visit ? ` · ${visit.length}` : ''}` }]} /></div> : undefined} />
        {hasShop && <div className="mt-3 sm:hidden"><Seg value={tab || 'shop'} onChange={(v) => setTab(v)} options={[{ id: 'shop', label: `Shop${shop ? ` · ${shop.length}` : ''}` }, { id: 'visit', label: `Visits${visit ? ` · ${visit.length}` : ''}` }]} /></div>}
        {failed && <p role="alert" className="m-0 mt-4 rounded-2xl p-4 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>Some reviews couldn’t be loaded. Refresh the page to try again.</p>}

        <div className="mt-5 flex flex-wrap items-start gap-5">
          <div ref={listRef} tabIndex={-1} role="region" aria-label="Reviews" className="min-w-0 flex-[3_1_560px] space-y-3.5 outline-none">
            {loading ? <p role="status" className="m-0 py-10 text-[15px]" style={muted}>Loading reviews…</p> : <>
              {longWaits > 0 && canEdit && (
                <p role="status" className="m-0 rounded-2xl p-4 text-[14.5px] leading-snug" style={{ background: C.warnSoft, color: C.warn }}>
                  {longWaits === 1 ? 'One review has' : `${longWaits} reviews have`} waited more than a week. A review left waiting stays off your page the same as a hidden one, so show it, or hide it with its reason.
                </p>)}
              {counts.all > 0 && (
                <div className="flex flex-wrap gap-7 p-4" style={box}>
                  <div><p className="m-0 text-[30px] font-light tracking-[-0.02em]">{counts.shown ? counts.avg.toFixed(1) : '–'}</p><p className="m-0 text-[13px]" style={muted}>{counts.shown ? `average of the ${counts.shown} shown` : 'none shown yet'}</p></div>
                  <div><p className="m-0 text-[30px] font-light tracking-[-0.02em]" style={counts.waiting ? { color: C.warn } : undefined}>{counts.waiting}</p><p className="m-0 text-[13px]" style={muted}>waiting for you</p></div>
                  <div><p className="m-0 text-[30px] font-light tracking-[-0.02em]">{counts.hidden}</p><p className="m-0 text-[13px]" style={muted}>hidden, each with its reason</p></div>
                </div>)}
              {counts.all > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {(['waiting', 'shown', 'hidden', 'all'] as Filter[]).filter((x) => x !== 'waiting' || counts.waiting || f === 'waiting').map((x) => (
                    <button key={x} type="button" aria-pressed={f === x} onClick={() => { setFilter(x); setHiding(null); }}
                      className="cf-press h-10 rounded-full px-3.5 text-[14px] font-semibold" style={f === x ? { border: `2px solid ${C.ink}`, padding: '0 13px' } : { border: `1px solid ${C.line}` }}>
                      {x === 'waiting' ? `Waiting · ${counts.waiting}` : x === 'shown' ? `Shown · ${counts.shown}` : x === 'hidden' ? `Hidden · ${counts.hidden}` : 'All'}
                    </button>))}
                  {choices.length > 1 && (
                    <label className="ml-auto flex items-center gap-2 text-[14px]" style={muted}>{tab === 'shop' ? 'Product' : 'Who'}
                      <select value={pick} onChange={(e) => setPick(e.target.value)} className="h-10 max-w-[14rem] rounded-xl border px-2.5 text-[14px]" style={{ borderColor: C.line, background: C.paper, color: C.ink }}>
                        <option value="">{tab === 'shop' ? 'All products' : 'Everyone'}</option>
                        {choices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </label>)}
                </div>)}

              {counts.all === 0 ? (
                <div className="px-2 py-12 text-center">
                  <p className="m-0 text-[20px] font-light">{tab === 'shop' ? 'No shop reviews yet' : 'No visit reviews yet'}</p>
                  <p className="m-0 mx-auto mt-1 max-w-md text-[15px] leading-snug" style={muted}>{tab === 'shop'
                    ? `Customers review from their order page once it’s picked up or delivered.${S.ask.on ? '' : ' Turn on Ask for a review to email them.'}`
                    : 'Clients are asked how it went in the thank-you the day after their visit.'}</p>
                </div>
              ) : shown.length === 0 ? (
                <p className="m-0 px-1 py-8 text-[15px]" style={muted}>{f === 'waiting' ? 'Nothing waiting for you.' : f === 'shown' ? 'No reviews shown yet.' : f === 'hidden' ? 'No hidden reviews.' : 'No reviews match.'}</p>
              ) : shown.map((r) => {
                const open = hiding?.id === r.id;
                const days = waitedDays(r);
                const tag = r.state === 'waiting' ? { t: `${days >= 2 ? `Waiting ${days} days` : 'Waiting'}${r.edited ? ' · Edited' : ''}`, c: C.warn } : r.state === 'shown' ? { t: r.pinned ? 'Shown · Pinned' : 'Shown', c: C.ok } : { t: `Hidden${r.reason ? ` · ${hideReasonShort(r.reason)}` : ''}${r.edited && Date.parse(r.edited) > Date.parse(r.hiddenAt || '') ? ' · Edited since' : ''}`, c: C.muted };
                const what = r.kind === 'shop'
                  ? [r.who, r.productName, r.orderNumber ? `order ${r.orderNumber}` : '', r.at ? `reviewed ${day(r.at)}` : ''].filter(Boolean).join(' · ')
                  : [r.who, [r.service, staffName.get(r.staffId || '') ? `with ${staffName.get(r.staffId || '')}` : ''].filter(Boolean).join(' '), r.at ? `reviewed ${day(r.at)}` : ''].filter(Boolean).join(' · ');
                const low = r.kind === 'visit' && r.rating <= star;
                return (
                  <article key={`${r.kind}-${r.id}`} className="p-4" style={open ? { ...box, border: `2px solid ${C.ink}`, padding: 15 } : box} aria-label={`${r.rating}-star review from ${r.who}`}>
                    <div className="flex flex-wrap items-start gap-4">
                      <div className="min-w-0 flex-[1_1_360px]">
                        <p className="m-0 flex flex-wrap items-center gap-2.5"><Stars n={r.rating} /><span className="text-[13px] font-semibold" style={{ color: tag.c }}>{tag.t}</span></p>
                        {r.title && <p className="m-0 mt-2 text-[15px] font-semibold">{r.title}</p>}
                        {r.body && <p className={`m-0 ${r.title ? 'mt-1' : 'mt-2'} whitespace-pre-line text-[14.5px] leading-relaxed`}>{r.body}</p>}
                        <p className="m-0 mt-2 text-[13px] leading-relaxed" style={muted}>
                          {what}
                          {r.kind === 'shop' && r.orderId && <> · <Link href={`/retail-orders?order=${encodeURIComponent(r.orderId)}`} className={linkCls} style={{ color: C.ink }}>Open order</Link></>}
                          {r.kind === 'visit' && r.clientId && <> · <Link href={`/clients/${encodeURIComponent(r.clientId)}`} className={linkCls} style={{ color: C.ink }}>Open client</Link></>}
                          {low && (r.caseId
                            ? <> · <Link href={`/cases?id=${encodeURIComponent(r.caseId)}`} className={linkCls} style={{ color: C.ink }}>Open its case</Link></>
                            : <> · at or below your follow-up line: <Link href={`/cases?start=review&visitReview=${encodeURIComponent(r.id)}`} className={linkCls} style={{ color: C.ink }}>Start a case</Link></>)}
                        </p>
                      </div>
                      {canEdit && !open && (
                        <div className="flex gap-2">
                          {r.state !== 'shown' && <Btn kind="primary" disabled={busy === r.id} onClick={() => void act(r, 'shown')}>{busy === r.id ? 'Showing…' : 'Show'}</Btn>}
                          {r.kind === 'visit' && r.state === 'shown' && <Btn kind="plain" disabled={busy === r.id} onClick={() => void pin(r, !r.pinned)}>{r.pinned ? 'Unpin' : 'Pin to the top'}</Btn>}
                          {r.state !== 'hidden' && <Btn id={`hide-${r.kind}-${r.id}`} kind="soft" disabled={busy === r.id} onClick={() => openHide(r)}>Hide</Btn>}
                        </div>)}
                    </div>
                    {open && (
                      <fieldset className="m-0 mt-3.5 flex flex-col gap-0.5 rounded-2xl p-3.5" style={{ border: `1px solid ${C.line}`, background: C.soft }}>
                        <legend className="px-1.5 text-[13px] font-semibold" style={muted}>Why hide it?</legend>
                        {HIDE_REASONS.map((h) => (
                          <label key={h.id} className="flex min-h-11 items-center gap-2.5 text-[15px]">
                            <input type="radio" name={`why-${r.id}`} checked={hiding?.reason === h.id} onChange={() => setHiding({ id: r.id, reason: h.id })} className="h-5 w-5 shrink-0" style={{ accentColor: '#16171a' }} />
                            {r.kind === 'shop' ? h.shop : h.visit}
                          </label>))}
                        <p className="m-0 mt-1 text-[13px]" style={muted}>The reason is kept with the review. A low rating isn’t a reason to hide one.</p>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <Btn kind="primary" disabled={!hiding?.reason || busy === r.id} onClick={() => hiding?.reason && void act(r, 'hidden', hiding.reason)}>{busy === r.id ? 'Hiding…' : 'Hide this review'}</Btn>
                          <Btn kind="plain" disabled={busy === r.id} onClick={() => closeHide(r)}>Cancel</Btn>
                        </div>
                      </fieldset>)}
                    {rowErr?.id === r.id && <p role="alert" className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>{rowErr.text}</p>}
                  </article>);
              })}
              {tab === 'shop' && counts.all > 0 && <p className="m-0 text-[13px] leading-snug" style={muted}>Shown reviews appear on the product’s page and count toward its stars. Hidden ones stay here with their reason, and the customer isn’t told.</p>}
              {tab === 'visit' && counts.shown > 0 && <p className="m-0 text-[13px] leading-snug" style={muted}>Pinned reviews come first on your booking page.</p>}
              {(rows || []).length >= LIMIT && <p className="m-0 text-[13px]" style={muted}>Showing the newest {LIMIT}.</p>}
            </>}
          </div>
          {tab && (
            <aside className="min-w-0 flex-[1_1_300px] space-y-3.5" aria-label="How reviews work">
              {settingsCol}
              {said && <p role={said.bad ? 'alert' : 'status'} className="m-0 px-1 text-[13.5px]" style={{ color: said.bad ? C.warn : C.ok }}>{said.text}</p>}
            </aside>)}
        </div>
      </div>
    </div>);
}
