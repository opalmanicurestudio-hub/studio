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
  const [sheet, setSheet] = React.useState<{ title: string; items: [string, () => void][] } | null>(null);   // the action sheet (rows and categories)
  const [share, setShare] = React.useState<{ title: string; url: string } | null>(null);
  // Share: copy a link (for their website / bio / Google profile) or show a QR code (for price lists, mirrors, stories).
  const [qr, setQr] = React.useState<{ title: string; url: string; src: string } | null>(null); const [toast, setToast] = React.useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 2200); };
  const openShare = (title: string, x: { serviceId?: string; category?: string }) => { if (!linkFor) return; setShare({ title, url: linkFor(x, 'website') }); };
  const copyText = async (t: string) => { try { await navigator.clipboard.writeText(t); say('Link copied'); } catch { window.prompt('Copy this link', t); } };
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
            <button type="button" aria-label={`Options for ${cat === '__addons' ? 'add-ons' : cat}`} onClick={() => setSheet({ title: cat === '__addons' ? 'Add-ons' : cat, items: [...(linkFor && cat !== '__addons' ? [['Share a link to this category', () => openShare(cat, { category: cat })] as [string, () => void]] : []), [cat === '__addons' ? 'Add an add-on' : 'Add a service here', () => onAddIn(cat === '__addons' ? null : cat)]] })} className="h-9 w-9 rounded-full text-[18px]" style={{ background: 'var(--soft)' }}>⋯</button>
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
                <button type="button" aria-label={`Actions for ${s.name}`} onClick={() => setSheet({ title: s.name, items: [['Edit', () => onEdit(s)], ...(linkFor && cat !== '__addons' ? [['Share a link to book this', () => openShare(s.name, { serviceId: s.id })] as [string, () => void], ['QR code', () => showQr(s.name, { serviceId: s.id })] as [string, () => void]] : []), ['Make a copy', () => onDuplicate(s)], [hidden ? 'Show on the booking page' : 'Hide from the booking page', () => onShowOnline(s, hidden)], ['Move up', () => move(cat, rows, i, -1)], ['Move down', () => move(cat, rows, i, 1)], ['Archive', () => onArchive(s)]] })} className="h-9 w-9 rounded-full text-[18px]" style={{ background: 'var(--soft)' }}>⋯</button>
              </div>); })}
        </section>))}
      {!groups.length && <p className="text-[15px]" style={muted}>No services yet — add your first one.</p>}
      <p className="px-2 text-[13px]" style={muted}>The order here is the order on your booking page. Use a row’s menu to move it up or down.</p>
      {sheet && <div role="dialog" aria-label={sheet.title} className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,.35)' }} onClick={() => setSheet(null)}>
        <div className="w-full max-w-md rounded-t-3xl p-2 pb-6 sm:rounded-3xl sm:pb-2" style={{ background: 'var(--card)' }} onClick={(e) => e.stopPropagation()}>
          <p className="px-4 pb-1 pt-3 text-[13px] font-semibold" style={muted}>{sheet.title}</p>
          {sheet.items.map(([l, f]) => <button key={l} type="button" onClick={() => { setSheet(null); f(); }} className="block w-full rounded-2xl px-4 py-3.5 text-left text-[16px] hover:bg-black/5">{l}</button>)}
          <button type="button" onClick={() => setSheet(null)} className="mt-1 block w-full rounded-2xl px-4 py-3.5 text-center text-[16px] font-semibold" style={{ background: 'var(--soft)' }}>Cancel</button>
        </div>
      </div>}
      {share && <div role="dialog" aria-label={`Share — ${share.title}`} className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(0,0,0,.35)' }} onClick={() => setShare(null)}>
        <div className="w-full max-w-md space-y-3 rounded-t-3xl p-5 sm:rounded-3xl" style={{ background: 'var(--card)' }} onClick={(e) => e.stopPropagation()}>
          <p className="text-[17px] font-semibold">Book {share.title}</p>
          <p className="text-[13px]" style={muted}>Opens straight to this on your booking page — for your website, bio or Google profile. Bookings from it show as “website” in Reports.</p>
          <p className="break-all rounded-2xl p-3 text-[13px]" style={{ background: 'var(--soft)' }}>{share.url}</p>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => void copyText(share.url)} className="h-11 rounded-full text-[14px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Copy</button>
            <a href={share.url} target="_blank" rel="noreferrer" className="h-11 rounded-full text-center text-[14px] font-semibold leading-[44px]" style={{ background: 'var(--soft)' }}>Open</a>
            <button type="button" onClick={() => { setQr({ title: share.title, url: share.url.replace('src=website', 'src=qr'), src: '' }); setShare(null); }} className="h-11 rounded-full text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>QR code</button>
          </div>
        </div>
      </div>}
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
