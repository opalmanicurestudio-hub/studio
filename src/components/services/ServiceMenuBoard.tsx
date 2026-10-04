'use client';
// src/components/services/ServiceMenuBoard.tsx — THE MENU BOARD: services grouped by category, in the order clients see
// them on the booking page. Edit a price in place, move a row up or down (menu order), and act on a row from its menu.
// Add-ons sit in their own group at the bottom, with the services they're offered with. Rows stack the same way on a phone.
import * as React from 'react';

type Row = any;
const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;

export function ServiceMenuBoard({ services, timingRows, bookings30, attention, costOf, selected, onToggleSelect, onEdit, onDuplicate, onAddIn, onSetPrice, onReorder, onShowOnline, onArchive, onFixLength, linkFor }: {
  services: Row[]; timingRows: any[]; bookings30: (id: string) => number; attention: (s: Row) => string[]; costOf: (s: Row) => { product: number; time: number };
  selected: Set<string>; onToggleSelect: (id: string) => void; onEdit: (s: Row) => void; onDuplicate: (s: Row) => void; onAddIn: (category: string | null) => void;
  onSetPrice: (s: Row, price: number) => void; onReorder: (category: string, orderedIds: string[]) => void; onShowOnline: (s: Row, shown: boolean) => void; onArchive: (s: Row) => void; onFixLength: (s: Row, minutes: number) => void;
  linkFor?: (x: { serviceId?: string; category?: string }, src: string) => string;   // shareable booking links (see lib/share-links)
}) {
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  // Share: copy a link (for their website / bio / Google profile) or show a QR code (for price lists, mirrors, stories).
  const [qr, setQr] = React.useState<{ title: string; url: string; src: string } | null>(null); const [toast, setToast] = React.useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 2200); };
  const copyLink = async (title: string, x: { serviceId?: string; category?: string }) => { if (!linkFor) return; const url = linkFor(x, 'website'); try { await navigator.clipboard.writeText(url); say(`Link copied — ${title}`); } catch { window.prompt('Copy this link', url); } };
  const showQr = (title: string, x: { serviceId?: string; category?: string }) => { if (!linkFor) return; setQr({ title, url: linkFor(x, 'qr'), src: '' }); };
  React.useEffect(() => { if (!qr || qr.src) return; let on = true; (async () => { try { const QR = (await import('qrcode')).default; const src = await QR.toDataURL(qr.url, { margin: 1, width: 360 }); if (on) setQr((q) => (q ? { ...q, src } : q)); } catch { /* fine */ } })(); return () => { on = false; }; }, [qr]);
  // Groups in category order; add-ons last. Within a group: menu order, then name.
  const groups = React.useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const s of services) { const k = s.type === 'addon' || s.isAddon ? '__addons' : String(s.category || 'Other'); m.set(k, [...(m.get(k) || []), s]); }
    const by = (a: Row, b: Row) => (Number.isFinite(a.menuOrder) ? a.menuOrder : 1e9) - (Number.isFinite(b.menuOrder) ? b.menuOrder : 1e9) || String(a.name).localeCompare(String(b.name));
    return [...m.entries()].map(([k, rows]) => [k, rows.sort(by)] as [string, Row[]]).sort((a, b) => (a[0] === '__addons' ? 1 : b[0] === '__addons' ? -1 : a[0].localeCompare(b[0])));
  }, [services]);
  const move = (cat: string, rows: Row[], i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= rows.length) return; const ids = rows.map((r) => r.id); [ids[i], ids[j]] = [ids[j], ids[i]]; onReorder(cat, ids); };
  const line = { borderTop: '1px solid var(--line)' } as React.CSSProperties; const muted = { color: 'var(--muted)' } as React.CSSProperties;
  return (
    <div className="space-y-4">
      {groups.map(([cat, rows]) => (
        <section key={cat} className="overflow-hidden rounded-3xl" style={{ background: 'var(--card)', border: '1px solid var(--line)' }} aria-label={cat === '__addons' ? 'Add-ons' : cat}>
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
            <h2 className="text-[17px] font-semibold">{cat === '__addons' ? 'Add-ons' : cat} <span className="text-[14px] font-normal" style={muted}>· {rows.length}<span className="hidden sm:inline">{cat === '__addons' ? ' · offered with the services above' : ''}</span></span></h2>
            <span className="flex gap-1.5">
              {linkFor && cat !== '__addons' && <button type="button" onClick={() => void copyLink(cat, { category: cat })} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={{ background: 'var(--soft)' }} aria-label={`Copy a link to ${cat}`}>Link</button>}
              <button type="button" onClick={() => onAddIn(cat === '__addons' ? null : cat)} className="h-9 rounded-full px-4 text-[13px] font-semibold" style={{ background: 'var(--soft)' }}>Add here</button>
            </span>
          </div>
          {rows.map((s, i) => { const t = timingRows.find((x) => x.serviceId === s.id); const flags = attention(s); const c = costOf(s); const left = Number(s.price) > 0 ? Math.round(((s.price - c.product - c.time) / s.price) * 100) : null; const hidden = !!s.isPrivate;
            return (
              <div key={s.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:px-4" style={{ ...line, ...(selected.has(s.id) ? { background: 'color-mix(in srgb, var(--accent) 6%, var(--card))' } : {}) }}>
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => onToggleSelect(s.id)} aria-label={`Select ${s.name}`} className="h-5 w-5" />
                <div role="button" tabIndex={0} onClick={() => onEdit(s)} onKeyDown={(e) => { if (e.key === 'Enter') onEdit(s); }} className="min-w-0 cursor-pointer text-left" aria-label={`Edit ${s.name}`}>
                  <span className="block text-[15px] font-semibold leading-tight sm:truncate">{s.name}{hidden ? <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--soft)', color: 'var(--muted)' }}>hidden online</span> : null}</span>
                  <span className="block text-[13px] sm:truncate" style={muted}>{s.duration} min{cat !== '__addons' ? ` · ${bookings30(s.id)} this month` : ''}{left !== null ? <> · <span style={left < 30 ? { color: 'var(--warn)', fontWeight: 600 } : undefined}>{left < 0 ? 'below cost' : `${left}% left after cost`}</span></> : null}
                    {t && t.suggest !== s.duration && cat !== '__addons' ? <> · typically {t.typical} min <button type="button" onClick={(e) => { e.stopPropagation(); onFixLength(s, t.suggest); }} className="font-semibold underline underline-offset-2" style={{ color: 'var(--accent)' }}>book at {t.suggest}?</button></> : null}</span>
                  {flags.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{flags.map((f) => <span key={f} className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--warn)' }}>{f}</span>)}</span>}
                </div>
                <label className="col-start-2 flex items-center gap-1 text-[15px] font-semibold sm:col-start-auto">$<input type="number" step="0.01" inputMode="decimal" defaultValue={Number(s.price || 0).toFixed(2)} key={`${s.id}:${s.price}`} aria-label={`Price of ${s.name}`}
                  onBlur={(e) => { const v = Math.round((parseFloat(e.target.value) || 0) * 100) / 100; if (v !== Number(s.price)) onSetPrice(s, v); }} className="h-9 w-24 rounded-xl border px-2 text-right" style={{ borderColor: 'var(--line)' }} /></label>
                <div className="relative">
                  <button type="button" aria-label={`Actions for ${s.name}`} aria-expanded={menuFor === s.id} onClick={() => setMenuFor(menuFor === s.id ? null : s.id)} className="h-9 w-9 rounded-full text-[18px]" style={{ background: 'var(--soft)' }}>⋯</button>
                  {menuFor === s.id && <div role="menu" className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-2xl text-[14px]" style={{ background: 'var(--card)', border: '1px solid var(--line)', boxShadow: '0 8px 24px rgba(0,0,0,.08)' }} onMouseLeave={() => setMenuFor(null)}>
                    {([['Edit', () => onEdit(s)], ...(linkFor && cat !== '__addons' ? [['Copy link', () => void copyLink(s.name, { serviceId: s.id })], ['QR code', () => showQr(s.name, { serviceId: s.id })]] : []), ['Make a copy', () => onDuplicate(s)], [hidden ? 'Show on the booking page' : 'Hide from the booking page', () => onShowOnline(s, hidden)], ['Move up', () => move(cat, rows, i, -1)], ['Move down', () => move(cat, rows, i, 1)], ['Archive', () => onArchive(s)]] as [string, () => void][]).map(([l, f]) => (
                      <button key={l} type="button" role="menuitem" onClick={() => { setMenuFor(null); f(); }} className="block w-full px-4 py-2.5 text-left hover:bg-black/5">{l}</button>))}
                  </div>}
                </div>
              </div>); })}
        </section>))}
      {!groups.length && <p className="text-[15px]" style={muted}>No services yet — add your first one.</p>}
      <p className="px-2 text-[13px]" style={muted}>The order here is the order on your booking page. Use a row’s menu to move it up or down.</p>
      {toast && <div role="status" className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full px-4 py-2 text-[14px] font-semibold" style={{ background: 'var(--ink, #1c1917)', color: '#fff' }}>{toast}</div>}
      {qr && <div role="dialog" aria-label={`QR code — ${qr.title}`} className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.35)' }} onClick={() => setQr(null)}>
        <div className="w-full max-w-sm space-y-3 rounded-3xl p-5 text-center" style={{ background: 'var(--card)' }} onClick={(e) => e.stopPropagation()}>
          <p className="text-[17px] font-semibold">{qr.title}</p>
          {qr.src ? <img src={qr.src} alt={`QR code for booking ${qr.title}`} className="mx-auto h-60 w-60 rounded-xl" /> : <div className="mx-auto h-60 w-60 rounded-xl" style={{ background: 'var(--soft)' }} />}
          <p className="break-all text-[12px]" style={muted}>{qr.url}</p>
          <div className="flex justify-center gap-2">
            {qr.src && <a href={qr.src} download={`book-${String(qr.title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`} className="h-10 rounded-full px-4 text-[14px] font-semibold leading-10" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Download</a>}
            <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(qr.url); say('Link copied'); } catch { /* fine */ } }} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>Copy link</button>
            <button type="button" onClick={() => setQr(null)} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>Close</button>
          </div>
          <p className="text-[12px]" style={muted}>Bookings from this code show as “QR” in Reports.</p>
        </div>
      </div>}
    </div>);
}
