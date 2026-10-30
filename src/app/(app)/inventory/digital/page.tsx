'use client';
// /inventory/digital — YOUR DIGITAL PRODUCTS AND THE PEOPLE WHO BOUGHT THEM. Everything sold as a download, with what
// it sold and how much it's been opened; open one to see each buyer's access record (lib/entitlements): when they
// bought, the license they bought with, how long access lasts, downloads used and opens. Managers can give more
// downloads, extend access, close it with a reason or open it again (/api/retail/digital/access); a refund or a
// chargeback closes access on its own. With Digital protection (lib/device-limit), each buyer's devices are listed and
// a manager can reset them; buyers at their limit are marked. The team reads the records; only the server writes them.
import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { collection, getDocs, query, where, documentId, type Firestore } from 'firebase/firestore';
import { AppHeader } from '@/components/shared/AppHeader';
import { Btn, C, Sheet, muted } from '@/components/orders/ui';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useToast } from '@/hooks/use-toast';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { digitalLineAccess } from '@/lib/digital-access-rule';
import { downloadsLeft } from '@/lib/entitlements';
import { FOREVER } from '@/lib/entitlement-actions';
import { filesOf } from '@/lib/digital-product';
import { LicenseManager } from '@/components/inventory/LicenseManager';
import { atDeviceLimit, deviceCap, devicesOf, deviceWhen } from '@/lib/device-limit';
import { asSold } from '@/lib/variants';

const DAY = 864e5;
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const countWord = (n: number) => (['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n));
const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

type Kind = 'active' | 'nodl' | 'devices' | 'ending' | 'refunded' | 'disputed' | 'revoked' | 'expired' | 'inactive' | 'missing';
type Row = { ent: any; order: any; line: any; status: { label: string; tone: 'ok' | 'warn' | 'plain'; kind: Kind }; endsAt: string | null; cap: number | null };

/** Where a buyer stands, in words: the one access rule (lib/digital-access) over the order and their record. */
function standing(ent: any, order: any, line: any, now: number, cap: number | null = null): Row['status'] & { endsAt: string | null } {
  // Without its order, refunds and chargebacks can't be checked: said so, never shown as active.
  if (!order || !line) return { label: 'Order not found', tone: 'plain', kind: 'missing', endsAt: null };
  const a = digitalLineAccess(order, line, now, ent);
  const endsAt = a.endsAt && a.endsAt < FOREVER ? a.endsAt : null;
  if (!a.open) {
    const kind = (a.reason || 'inactive') as Kind;
    const label = kind === 'refunded' ? 'Refunded' : kind === 'disputed' ? 'Paused, payment disputed' : kind === 'revoked' ? 'Closed by the shop' : kind === 'expired' ? `Ended ${day(endsAt || '')}` : 'Not active';
    return { label, tone: 'plain', kind, endsAt };
  }
  const left = downloadsLeft(ent);
  if (left === 0) return { label: 'No downloads left', tone: 'warn', kind: 'nodl', endsAt };
  if (atDeviceLimit(ent, cap)) return { label: 'At device limit', tone: 'warn', kind: 'devices', endsAt };
  if (endsAt && Date.parse(endsAt) - now < 7 * DAY) { const n = Math.max(1, Math.ceil((Date.parse(endsAt) - now) / DAY)); return { label: `Ends in ${n} day${n === 1 ? '' : 's'}`, tone: 'warn', kind: 'ending', endsAt }; }
  return { label: 'Active', tone: 'ok', kind: 'active', endsAt };
}

export default function DigitalProductsPage() {
  const { firestore } = useFirebase() as any;
  const { selectedTenant, role } = useTenant() as any; const tenantId = String(selectedTenant?.id || '');
  // Managers change a buyer's access; the rest of the team can look (the server checks again).
  const canEdit = ['owner', 'admin', 'manager'].includes(String(role || ''));
  const { inventory } = useInventory() as any;
  const { toast } = useToast();
  const [ents, setEnts] = React.useState<any[] | null>(null);
  // Everything sold as a download, plus anything someone bought that's since been archived or switched off, so those
  // buyers can still be looked after.
  const products = React.useMemo(() => {
    const live = (inventory || []).filter((i: any) => i.digital === true && i.status !== 'archived');
    const byId = new Map((inventory || []).map((i: any) => [String(i.id), i]));
    const known = new Set(live.map((i: any) => String(i.id)));
    const others: any[] = [];
    for (const e of ents || []) { const id = String(e.productId || ''); if (id && !known.has(id)) { known.add(id); others.push({ ...(byId.get(id) || {}), id, name: (byId.get(id) as any)?.name || e.name || 'A download', retired: true }); } }
    return [...live.sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))), ...others];
  }, [inventory, ents]);
  const [orders, setOrders] = React.useState<Record<string, any>>({});
  const [pick, setPick] = React.useState<string>('');
  const [find, setFind] = React.useState('');
  const [open, setOpen] = React.useState<Row | null>(null);
  const [licenses, setLicenses] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!firestore || !tenantId) return;
    try {
      const snap = await getDocs(collection(firestore as Firestore, `tenants/${tenantId}/entitlements`));
      const all = snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }));
      setEnts(all);
      // Each record's order, for refunds and chargebacks (the access rule reads them), 30 at a time.
      const ids = [...new Set(all.map((e) => String(e.orderId || '')).filter(Boolean))];
      const got: Record<string, any> = {};
      const chunks: string[][] = []; for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
      const snaps = await Promise.all(chunks.map((c) => getDocs(query(collection(firestore as Firestore, `tenants/${tenantId}/retailOrders`), where(documentId(), 'in', c)))));
      snaps.forEach((sn) => sn.docs.forEach((d) => { got[d.id] = { ...(d.data() as any), id: d.id }; }));
      setOrders(got);
    } catch { setErr('Buyers couldn’t be loaded. Check your connection and try again.'); setEnts([]); }
  }, [firestore, tenantId]);
  React.useEffect(() => { void load(); }, [load]);
  // Opens on the product that sold the most.
  React.useEffect(() => {
    if (pick || !products.length || ents === null) return;
    const n = (id: string) => ents.filter((e) => String(e.productId) === id).length;
    setPick(String([...products].sort((a: any, b: any) => n(String(b.id)) - n(String(a.id)))[0].id));
  }, [products, pick, ents]);

  const now = Date.now();
  // The device limit on each buyer (Digital protection): the product as sold, a variant taking its listing's.
  const itemById = React.useMemo(() => new Map((inventory || []).map((i: any) => [String(i.id), i])), [inventory]);
  const capFor = (ent: any): number | null => {
    const it: any = itemById.get(String(ent.productId || ''));
    if (!it) return null;
    const parent: any = it.parentId && it.digital !== true ? itemById.get(String(it.parentId)) : null;
    return deviceCap(selectedTenant, parent ? asSold(parent, it) : it, ent);
  };
  const rowsFor = (pid: string): Row[] => (ents || []).filter((e) => String(e.productId) === pid).map((ent) => {
    const order = orders[String(ent.orderId)] || null;
    const line = order ? (order.lines || []).find((l: any) => String(l.lineId || l.productId) === String(ent.lineId || ent.productId)) || null : null;
    const cap = capFor(ent);
    const s = standing(ent, order, line, now, cap);
    return { ent, order, line, status: { label: s.label, tone: s.tone, kind: s.kind }, endsAt: s.endsAt, cap };
  }).sort((a, b) => String(b.ent.createdAt || '').localeCompare(String(a.ent.createdAt || '')));

  const month = (ents || []).filter((e) => now - Date.parse(e.createdAt || '') < 30 * DAY);
  const soldCents = month.reduce((n, e) => { const o = orders[String(e.orderId)]; const l = o?.lines?.find((x: any) => String(x.lineId || x.productId) === String(e.lineId || e.productId)); return n + (l ? Math.round(Number(l.unitPriceCents) || 0) * Math.max(1, Number(l.qtyOrdered) || 1) : 0); }, 0);
  const allRows: Row[] = products.flatMap((p: any) => rowsFor(String(p.id)));
  const withAccess = allRows.filter((r) => r.status.tone !== 'plain').length;
  const endingSoon = allRows.filter((r) => r.status.kind === 'ending').length;
  const atLimit = allRows.filter((r) => r.status.kind === 'devices').length;
  const opens = month.reduce((n, e) => n + (Number(e.views) || 0) + (Number(e.downloads?.used) || 0), 0);
  const closed = allRows.filter((r) => r.status.tone === 'plain');

  const cur = products.find((p: any) => String(p.id) === pick) || null;
  const f = find.trim().toLowerCase();
  const rows = cur ? rowsFor(String(cur.id)).filter((r) => !f || [r.ent.email, r.order?.customerName, String(r.order?.orderNumber ?? '')].some((x) => String(x || '').toLowerCase().includes(f))) : [];

  const tile = (k: string, v: React.ReactNode, sub: string) => (
    <div className="rounded-2xl p-4" style={{ background: C.soft }}><p className="m-0 text-[13px] font-semibold" style={muted}>{k}</p><p className="m-0 mt-0.5 text-[28px] font-light tracking-[-0.02em]">{v}</p><p className="m-0 text-[13px]" style={muted}>{sub}</p></div>);
  const tag = (s: Row['status']) => (
    <span className="inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12.5px] font-semibold" style={s.tone === 'ok' ? { background: C.okSoft, color: C.ok } : s.tone === 'warn' ? { background: C.warnSoft, color: C.warn } : { background: C.soft, color: C.ink }}>{s.label}</span>);
  const dl = (e: any) => (e.downloads?.allowed == null ? 'No limit' : `${Number(e.downloads?.used) || 0} of ${(Number(e.downloads?.allowed) || 0) + (Number(e.downloads?.extra) || 0)}`);
  const access = (r: Row) => (r.ent.access?.extendedUntil === FOREVER || !r.endsAt ? 'Yours to keep' : `Until ${day(r.endsAt)}`);

  return (
    <>
      <AppHeader title="Digital products" />
      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-5 px-4 pb-16 pt-5 md:px-6" style={{ color: C.ink }}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><Link href="/inventory" className="inline-flex min-h-11 items-center text-[14px]" style={muted}>Products</Link><h1 className="m-0 text-[34px] font-light tracking-[-0.025em]">Digital products</h1></div>
          {canEdit && <div className="flex flex-wrap gap-2"><Btn onClick={() => setLicenses(true)}>Your licenses</Btn></div>}
        </div>
        {err && <p role="alert" className="m-0 text-[15px]" style={{ color: C.bad }}>{err}</p>}

        {products.length === 0 ? (
          <div className="rounded-2xl p-6" style={{ background: C.soft }}>
            <p className="m-0 text-[17px] font-semibold">Nothing sold as a download yet</p>
            <p className="m-0 mt-1 text-[15px]" style={muted}>Open a product, and under In the shop turn on Sold as a download.</p>
          </div>
        ) : (<>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            {tile('Sold, last 30 days', month.length, `${money(soldCents)} · ${products.length} product${products.length === 1 ? '' : 's'}`)}
            {tile('Buyers with access', withAccess, [endingSoon ? `${endingSoon} ${endingSoon === 1 ? 'ends' : 'end'} this week` : 'None ending this week', atLimit ? `${atLimit} at their device limit` : ''].filter(Boolean).join(' · '))}
            {tile('Opens, last 30 days', opens, 'Views and saved copies')}
            {tile('Closed', closed.length, `${closed.filter((r) => r.status.kind === 'refunded').length} refunded · ${closed.filter((r) => r.status.kind === 'disputed').length} disputed · ${closed.filter((r) => r.status.kind === 'revoked').length} by you`)}
          </div>

          <div className="flex flex-wrap items-start gap-5">
            <nav aria-label="Digital products" className="flex min-w-0 flex-col gap-1" style={{ flex: '1 1 260px', maxWidth: 360 }}>
              {products.map((p: any) => {
                const on = String(p.id) === pick; const n = (ents || []).filter((e) => String(e.productId) === String(p.id)).length;
                const img = (Array.isArray(p.imageUrls) && p.imageUrls[0]) || p.imageUrl || '';
                return (
                  <button key={p.id} type="button" aria-pressed={on} onClick={() => { setPick(String(p.id)); setFind(''); }} className="flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left" style={{ background: on ? C.soft : 'transparent', color: C.ink }}>
                    <span className="relative h-11 w-11 flex-none overflow-hidden rounded-xl" style={{ background: C.soft }}>{img ? <Image src={img} alt="" fill sizes="44px" className="object-cover" /> : null}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{p.name}</span><span className="block truncate text-[13px]" style={muted}>{p.retired ? 'No longer sold · ' : ''}{n} sold · {filesOf(p).length} file{filesOf(p).length === 1 ? '' : 's'} · {p.license?.name || 'Personal use'}</span></span>
                  </button>);
              })}
            </nav>

            {cur && (
              <section aria-labelledby="buyers-h" className="flex min-w-0 flex-col gap-3" style={{ flex: '999 1 560px' }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="buyers-h" className="m-0 text-[17px] font-semibold">{cur.name} · {rowsFor(String(cur.id)).length} buyer{rowsFor(String(cur.id)).length === 1 ? '' : 's'}</h2>
                  <div className="flex flex-wrap gap-2">
                    <input aria-label="Find a buyer" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a buyer by name, email or order" className="h-11 w-[280px] max-w-full rounded-xl px-3 text-[14px]" style={{ border: `1px solid ${C.line}`, background: C.paper }} />
                    <Link href={`/inventory/product/${encodeURIComponent(String(cur.id))}?tab=online`} className="inline-flex h-11 items-center rounded-full px-4 text-[15px] font-medium" style={{ background: C.soft, color: C.ink }}>Edit the product</Link>
                  </div>
                </div>
                {ents === null ? <p role="status" className="m-0 text-[15px]" style={muted}>Loading buyers…</p> : rows.length === 0 ? (
                  <p className="m-0 rounded-2xl p-5 text-[15px]" style={{ background: C.soft, ...muted }}>{f ? 'No buyer matches that.' : 'No one has bought this yet.'}</p>
                ) : (<>
                  <div className="hidden overflow-x-auto rounded-2xl md:block" style={{ border: `1px solid ${C.line}` }}>
                    <table className="w-full border-collapse text-[14px]">
                      <thead><tr>{['Buyer', 'Bought', 'License', 'Access', 'Downloads', 'Opens', 'Status', ''].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-3 py-2.5 text-left text-[12.5px] font-semibold" style={{ ...muted, borderBottom: `1px solid ${C.line}` }}>{h || <span className="sr-only">Actions</span>}</th>)}</tr></thead>
                      <tbody>{rows.map((r) => (
                        <tr key={r.ent.id} style={{ borderBottom: `1px solid ${C.line}` }}>
                          <td className="px-3 py-3"><span className="block font-semibold">{r.order?.customerName || r.ent.email || 'Buyer'}</span><span className="block text-[13px]" style={muted}>#{String(r.order?.orderNumber ?? '').padStart(4, '0')}{r.ent.copies > 1 ? ` · ${r.ent.copies} copies` : ''}</span></td>
                          <td className="whitespace-nowrap px-3 py-3">{day(r.ent.createdAt)}</td>
                          <td className="px-3 py-3">{r.ent.license?.name || 'Personal use'}</td>
                          <td className="whitespace-nowrap px-3 py-3">{access(r)}</td>
                          <td className="whitespace-nowrap px-3 py-3">{dl(r.ent)}</td>
                          <td className="px-3 py-3">{(Number(r.ent.views) || 0) + (Number(r.ent.downloads?.used) || 0)}</td>
                          <td className="px-3 py-3">{tag(r.status)}</td>
                          <td className="px-3 py-3"><button type="button" aria-label={`Manage ${r.order?.customerName || r.ent.email || 'this buyer'}`} onClick={() => setOpen(r)} className="h-11 rounded-full px-4 text-[13px] font-semibold" style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink }}>Manage</button></td>
                        </tr>))}</tbody>
                    </table>
                  </div>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0 md:hidden">{rows.map((r) => (
                    <li key={r.ent.id}><button type="button" onClick={() => setOpen(r)} className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left" style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink }}>
                      <span className="min-w-0"><span className="block truncate text-[15px] font-semibold">{r.order?.customerName || r.ent.email || 'Buyer'}</span><span className="block text-[13px]" style={muted}>{day(r.ent.createdAt)} · {dl(r.ent)}</span></span>{tag(r.status)}
                    </button></li>))}</ul>
                </>)}
                <p className="m-0 text-[13px]" style={muted}>A refund or a chargeback closes access on its own; a won chargeback opens it again. Changes you make are kept on each buyer’s record.</p>
              </section>)}
          </div>
        </>)}
      </main>
      {open && <BuyerSheet row={open} tenantId={tenantId} canEdit={canEdit} onClose={() => setOpen(null)} onDone={async (msg) => { toast({ title: msg }); setOpen(null); await load(); }} onError={(m) => toast({ variant: 'destructive', title: 'Not changed', description: m })} />}
      {licenses && <LicenseManager tenantId={tenantId} tenant={selectedTenant} onClose={() => setLicenses(false)} />}
    </>);
}

/** One buyer: their record, and what a manager can change. */
function BuyerSheet({ row, tenantId, canEdit, onClose, onDone, onError }: { row: Row; tenantId: string; canEdit: boolean; onClose: () => void; onDone: (msg: string) => void; onError: (m: string) => void }) {
  const e = row.ent;
  const [mode, setMode] = React.useState<'' | 'more' | 'extend' | 'close'>('');
  const [count, setCount] = React.useState('5');
  const [until, setUntil] = React.useState('');
  const [forever, setForever] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const field: React.CSSProperties = { border: `1px solid ${C.line}`, background: C.paper, color: C.ink, borderRadius: 12 };

  const send = async (action: any) => {
    setBusy(true);
    try {
      const res = await fetch('/api/retail/digital/access', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, id: e.id, action }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) { onError(d.error || 'Try again.'); return; }
      onDone(`${d.what}${d.emailed ? '. They’ve been emailed.' : '.'}`);
    } catch { onError('Check your connection and try again.'); }
    finally { setBusy(false); }
  };

  const closed = row.status.kind === 'revoked';
  const hist = Array.isArray(e.history) ? [...e.history].reverse().slice(0, 8) : [];
  const devices = devicesOf(e);
  const full = atDeviceLimit(e, row.cap);
  const actBtn = (label: string, sub: string, onClick: () => void, danger = false) => (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-4 text-left text-[15px] font-semibold" style={{ border: `1px solid ${C.line}`, background: C.paper, color: danger ? C.bad : C.ink }}>{label}<span className="text-[14px] font-normal" style={muted}>{sub}</span></button>);

  return (
    <Sheet title={row.order?.customerName || e.email || 'Buyer'} sub={`Order ${String(row.order?.orderNumber ?? '').padStart(4, '0')} · ${day(e.createdAt)}${e.copies > 1 ? ` · ${e.copies} copies` : ''}`} onClose={onClose} closeLabel="Done">
      <div className="flex flex-col gap-4">
        <dl className="m-0 text-[15px]">
          {[['Product', e.name], ['License', e.license?.name || 'Personal use'], ['Access', row.ent.access?.extendedUntil === FOREVER || !row.endsAt ? 'Yours to keep' : `Until ${day(row.endsAt)}`], ['Downloads', e.downloads?.allowed == null ? 'No limit' : `${Number(e.downloads?.used) || 0} of ${(Number(e.downloads?.allowed) || 0) + (Number(e.downloads?.extra) || 0)} used`], ['Opens', String((Number(e.views) || 0) + (Number(e.downloads?.used) || 0))], ['Status', row.status.label]].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-2.5" style={{ borderTop: `1px solid ${C.line}` }}><dt style={muted}>{k}</dt><dd className="m-0 text-right">{v}</dd></div>))}
        </dl>

        {mode === '' && (row.cap || devices.length > 0) && (
          <section aria-labelledby="devices-h" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 id="devices-h" className="m-0 text-[13px] font-semibold" style={muted}>Devices</h3>
              <span className="inline-flex h-6 items-center rounded-full px-2.5 text-[12.5px] font-semibold" style={full ? { background: C.warnSoft, color: C.warn } : { background: C.soft, color: C.ink }}>{row.cap ? `${devices.length} of ${row.cap}` : `${devices.length}`}</span>
            </div>
            {devices.length === 0 ? <p className="m-0 text-[14px]" style={muted}>Not opened on any device since the limit was turned on.</p> : (
              <ul className="m-0 list-none p-0">{devices.map((dv) => (
                <li key={dv.id} className="py-2.5" style={{ borderTop: `1px solid ${C.line}` }}><span className="block text-[15px]">{dv.label}</span><span className="block text-[13px]" style={muted}>{deviceWhen(dv)}</span></li>))}</ul>)}
            {!row.cap && <p className="m-0 text-[13px]" style={muted}>The device limit is off now, so any device opens it. The list is kept in case you turn it on again.</p>}
            {Number(e.deviceRefused?.count) > 0 && <p className="m-0 text-[13px]" style={{ color: C.warn }}>Refused on a new device {Number(e.deviceRefused.count) === 1 ? 'once' : `${Number(e.deviceRefused.count)} times`}, last {day(String(e.deviceRefused.at || ''))}{e.deviceRefused.label ? ` (${e.deviceRefused.label})` : ''}.</p>}
            {canEdit && devices.length > 0 && (<>
              <Btn kind={full ? 'primary' : 'soft'} className="w-full" disabled={busy} onClick={() => void send({ kind: 'reset_devices' })}>{busy ? 'Saving…' : 'Reset devices'}</Btn>
              <p className="m-0 text-[13px]" style={muted}>Clears the list so {row.cap ? (row.cap === 1 ? 'the next device they open it on counts' : `the next ${countWord(row.cap)} devices they open it on count`) : 'devices count'} from fresh. They’re emailed that it’s done. Kept on this buyer’s history with who reset it.</p>
            </>)}
          </section>)}

        {mode === '' && !canEdit && <p className="m-0 text-[14px]" style={muted}>A manager can give more downloads, extend or close access{devices.length ? ', or reset devices' : ''}.</p>}
        {mode === '' && canEdit && (
          <div className="flex flex-col gap-2">
            {e.downloads?.allowed != null && actBtn('Give more downloads', `${downloadsLeft(e) ?? 0} left`, () => setMode('more'))}
            {row.endsAt ? actBtn('Extend access', `${row.status.kind === 'expired' ? 'Ended' : 'Ends'} ${day(row.endsAt)}`, () => setMode('extend')) : <p className="m-0 px-1 text-[14px]" style={muted}>Their access has no end date.</p>}
            {closed ? actBtn('Open access again', 'They’re told', () => void send({ kind: 'reopen' })) : actBtn('Close access', 'With a reason', () => setMode('close'), true)}
          </div>)}

        {mode === 'more' && (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-3 text-[15px]">More downloads<input inputMode="numeric" value={count} onChange={(ev) => setCount(ev.target.value.replace(/\D/g, '').slice(0, 3))} className="h-11 w-20 px-3 text-center text-[15px]" style={field} aria-label="How many more downloads" /></label>
            <div className="flex gap-2"><Btn kind="primary" disabled={busy || !(Number(count) >= 1 && Number(count) <= 100)} onClick={() => void send({ kind: 'add_downloads', count: Number(count) })}>{busy ? 'Saving…' : `Give ${Number(count) || 0} more`}</Btn><Btn kind="plain" onClick={() => setMode('')}>Back</Btn></div>
          </div>)}

        {mode === 'extend' && (
          <div className="flex flex-col gap-3">
            <label className="flex min-h-11 items-center gap-3 text-[15px]"><input type="checkbox" checked={forever} onChange={(ev) => setForever(ev.target.checked)} className="h-5 w-5" />No end date</label>
            {!forever && <label className="flex flex-col gap-1.5 text-[13px] font-semibold" style={muted}>Access until<input type="date" value={until} min={new Date(Date.now() + DAY).toISOString().slice(0, 10)} onChange={(ev) => setUntil(ev.target.value)} className="h-11 px-3 text-[15px] font-normal" style={field} /></label>}
            <div className="flex gap-2"><Btn kind="primary" disabled={busy || (!forever && !until)} onClick={() => void send({ kind: 'extend', until: forever ? 'forever' : new Date(`${until}T23:59:59`).toISOString() })}>{busy ? 'Saving…' : 'Extend access'}</Btn><Btn kind="plain" onClick={() => setMode('')}>Back</Btn></div>
          </div>)}

        {mode === 'close' && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold" style={muted}>Why (included in the email they get)<textarea value={reason} maxLength={200} rows={3} onChange={(ev) => setReason(ev.target.value)} placeholder="For example, the files were shared online." className="px-3 py-2 text-[15px] font-normal" style={field} /></label>
            <p className="m-0 text-[13px]" style={muted}>Closing access doesn’t refund anything. They can message you from their order page.</p>
            <div className="flex gap-2"><Btn kind="danger" disabled={busy || !reason.trim()} onClick={() => void send({ kind: 'revoke', reason })}>{busy ? 'Saving…' : 'Close access'}</Btn><Btn kind="plain" onClick={() => setMode('')}>Back</Btn></div>
          </div>)}

        {hist.length > 0 && (
          <div>
            <p className="m-0 text-[13px] font-semibold" style={muted}>On the record</p>
            <ul className="m-0 list-none p-0">{hist.map((h: any, i: number) => <li key={i} className="flex justify-between gap-3 py-2 text-[14px]"><span>{h.what}{h.by ? `, by ${h.by}` : ''}</span><span style={muted}>{day(h.at)}</span></li>)}</ul>
          </div>)}
      </div>
    </Sheet>);
}
