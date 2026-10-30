'use client';
// ─── /shop/[tenantId]/library/[orderId] ──────────────────────────────────────
// The customer's private shelf for what they bought on one order. Opening anything takes proof it's them (the order
// pass, lib/order-pass): the device that paid and their signed-in shop account have it already; anyone else gets a
// 6-digit code to the email or mobile on the order. A forwarded order email therefore opens nothing.
//
// Files open inside the page through a stream link signed for ten minutes, with the buyer's name, email and order
// number stamped into PDFs and laid over the viewer. The honest limit, said to the customer as well: a screen can
// always be photographed. The name on every page is what makes a leaked copy point back to whoever shared it.
//
// A download bought as a gift (lib/digital-gift) opens here for the person it was for, never the buyer: the link in the
// gift email confirms them, or a code to that email does, and their pass is their own (/api/retail/gift-library).
import { Loader, Lock } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { ShopHeader } from '@/components/shop/ShopChrome';

type Access = { open: boolean; reason: string | null; endsAt: string | null };
type Contents = { files: { id: string; name: string; inPage: boolean; size: number }[]; link: boolean; delivery: 'both' | 'view' | 'download' };
type Target = { fileId?: string; link?: boolean };
type Item = { key: string; lineId: string; productId: string; name: string; access: Access; left: number | null; license: { name: string; terms: string } | null; contents: Contents | null };
type Verify = { passOk: boolean; emailMasked: string | null; phoneEnding: string | null; canText: boolean };

const card: React.CSSProperties = { borderRadius: 'var(--shop-radius-card)', background: 'var(--shop-card)', border: '1px solid var(--shop-line)' };
const muted: React.CSSProperties = { color: 'var(--shop-muted)' };
const solid: React.CSSProperties = { borderRadius: 'var(--shop-radius-pill)', background: 'var(--shop-brand)', color: 'var(--shop-on-brand)' };
const outline: React.CSSProperties = { borderRadius: 'var(--shop-radius-pill)', border: '1px solid var(--shop-ink)', color: 'var(--shop-ink)' };
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function statusOf(a: Access): string {
  if (a.open) return a.endsAt ? `Available until ${day(a.endsAt)}` : 'Yours to keep';
  if (a.reason === 'expired' && a.endsAt) return `Access ended ${day(a.endsAt)}`;
  if (a.reason === 'refunded') return 'Refunded';
  if (a.reason === 'disputed') return 'Paused while a payment question is looked into';
  return 'Not available';
}

export default function LibraryPage({ params }: { params: Promise<{ tenantId: string; orderId: string }> }) {
  const { tenantId, orderId } = React.use(params);
  const buyerPassKey = `cfshop-pass-${tenantId}-${orderId}`;
  const giftPassKey = `cfshop-giftpass-${tenantId}-${orderId}`;
  const [items, setItems] = useState<Item[] | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [needCode, setNeedCode] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ item: Item; target: Target; url: string; name: string; watermark: string; inPage: boolean; canSave: boolean; left: number | null; license: { name: string; terms: string } | null } | null>(null);
  const [code, setCode] = useState({ id: '', sentTo: '', value: '', sending: false, checking: false });
  const [gift, setGift] = useState<{ toName: string; from: string; message: string; shopName: string } | null>(null);
  const giftMode = React.useRef(false);

  // Kept in memory too, so a device that can't save it (private browsing) still opens things for this visit.
  const passMem = React.useRef('');
  const keyNow = () => (giftMode.current ? giftPassKey : buyerPassKey);
  const readPass = () => { if (passMem.current) return passMem.current; try { return window.localStorage.getItem(keyNow()) || ''; } catch { return ''; } };
  const keepPass = (p: string) => { passMem.current = p; try { window.localStorage.setItem(keyNow(), p); } catch { /* private browsing: kept for this visit */ } };

  // The gift's own view: what was given, who from, and their access. The link's token is taken out of the address once
  // it has given this device a pass, so a copied address doesn't carry it.
  const loadGift = useCallback(async (token: string) => {
    giftMode.current = true;
    const res = await fetch('/api/retail/gift-library', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, orderId, ...(token ? { g: token } : { p: readPass() }) }) });
    const d = await res.json();
    if (!res.ok) { setErr(d.error || 'This gift could not be loaded.'); setItems([]); return; }
    if (d.newPass) keepPass(String(d.newPass));
    if (token) { try { window.history.replaceState(null, '', window.location.pathname); } catch { /* cosmetic */ } }
    setGift({ toName: String(d.toName || ''), from: String(d.from || ''), message: String(d.message || ''), shopName: String(d.shopName || '') });
    setVerify({ passOk: !!d.verify?.passOk, emailMasked: d.verify?.emailMasked || null, phoneEnding: null, canText: false });
    const digital = Array.isArray(d.lines) ? d.lines : [];
    setItems(digital.map((l: any) => ({ key: String(l.lineId || l.productId), lineId: String(l.lineId || ''), productId: l.productId, name: l.name, access: l.access || { open: true, reason: null, endsAt: null }, left: l.entitlement?.downloadsLeft ?? null, license: l.entitlement?.license || null, contents: l.contents || null })));
    setNeedCode(!d.verify?.passOk);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, orderId]);

  const load = useCallback(async () => {
    try {
      const token = (() => { try { return new URLSearchParams(window.location.search).get('g') || ''; } catch { return ''; } })();
      // A device that already opened this as a gift goes straight to it.
      const hasGiftPass = (() => { try { return !!window.localStorage.getItem(giftPassKey); } catch { return false; } })();
      if (token || giftMode.current || hasGiftPass) { await loadGift(token); return; }
      const qs = new URLSearchParams({ tenantId, orderId });
      const pass = readPass(); if (pass) qs.set('pass', pass);
      try {
        const here = new URLSearchParams(window.location.search);
        if (here.get('session_id')) qs.set('session_id', String(here.get('session_id')));
        const acct = JSON.parse(window.localStorage.getItem(`cfshop-acct-${tenantId}`) || 'null');
        if (acct?.e && acct?.x && acct?.s && Date.now() < Number(acct.x)) { qs.set('ae', String(acct.e)); qs.set('ax', String(acct.x)); qs.set('as', String(acct.s)); }
      } catch { /* the pass or a code still opens it */ }
      const res = await fetch(`/api/retail/order-status?${qs.toString()}`, { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'This library could not be loaded.'); return; }
      if (d.gift || d.order?.digitalGift) { passMem.current = ''; await loadGift(''); return; }
      if (d.newPass) keepPass(String(d.newPass));
      setVerify(d.verify || null);
      if (d.expired) { setNeedCode(true); setItems([]); return; }
      const digital = (d.order?.lines || []).filter((l: any) => l.digital === true);
      setItems(digital.map((l: any) => ({ key: String(l.lineId || l.productId), lineId: String(l.lineId || ''), productId: l.productId, name: l.name, access: l.access || { open: true, reason: null, endsAt: null }, left: l.entitlement?.downloadsLeft ?? null, license: l.entitlement?.license || null, contents: l.contents || null })));
      if (!digital.length) setErr('There’s nothing digital on this order.');
      setNeedCode(!(d.verify?.passOk));
    } catch {
      setErr('This library could not be loaded. Check your connection and try again.');
    }
  }, [tenantId, orderId, loadGift]);

  useEffect(() => { load(); }, [load]);

  const sendCode = async (via: 'email' | 'phone') => {
    setCode((c) => ({ ...c, sending: true })); setErr(null);
    try {
      const res = await fetch('/api/retail/order-pass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, orderId, action: 'send', via, gift: giftMode.current }) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'The code couldn’t be sent.'); return; }
      setCode((c) => ({ ...c, id: String(d.verificationId || ''), sentTo: String(d.sentTo || '') }));
    } catch { setErr('The code couldn’t be sent. Try again.'); }
    finally { setCode((c) => ({ ...c, sending: false })); }
  };

  const confirmCode = async () => {
    setCode((c) => ({ ...c, checking: true })); setErr(null);
    try {
      const res = await fetch('/api/retail/order-pass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, orderId, action: 'confirm', verificationId: code.id, code: code.value.trim(), gift: giftMode.current }) });
      const d = await res.json();
      if (!res.ok || !d.pass) { setErr(d.error || 'That code didn’t match.'); return; }
      keepPass(String(d.pass));
      setCode({ id: '', sentTo: '', value: '', sending: false, checking: false });
      setNeedCode(false);
      await load();
    } catch { setErr('That code couldn’t be checked. Try again.'); }
    finally { setCode((c) => ({ ...c, checking: false })); }
  };

  // View opens it here (never counted against downloads); download saves a copy (uses one). The server decides for
  // files that can't be shown in the page: those are always a saved copy.
  const open = async (it: Item, mode: 'view' | 'download' = 'view', target: Target = {}) => {
    if (busy) return;
    setBusy(`${it.key}${target.fileId || (target.link ? '~link' : '')}`); setErr(null); setNote(null);
    try {
      const res = await fetch('/api/retail/digital-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId, productId: it.productId, lineId: it.lineId || undefined, ...target, pass: readPass(), mode }),
      });
      const d = await res.json();
      if (d.needsPass) { setNeedCode(true); return; }
      if (!res.ok) { setErr(d.error || 'That couldn’t be opened.'); if (d.closed) load(); return; }
      if (d.kind === 'link') { window.open(d.url, '_blank', 'noopener,noreferrer'); setNote(`${d.name} opened in a new tab.`); return; }
      if (d.mode === 'download') {
        window.location.href = d.url;
        const left = typeof d.downloadsLeft === 'number' ? Math.max(0, d.downloadsLeft - 1) : null;
        const what = d.fileName || d.name;
        setNote(left === null ? `Saving ${what}.` : `Saving ${what}. ${left} download${left === 1 ? '' : 's'} left.`);
        setItems((xs) => (xs || []).map((x) => (x.key === it.key ? { ...x, left } : x)));
        setViewing((v) => (v ? { ...v, left } : v));
        // The count is made when the file is fetched; check back so the number shown is the real one.
        window.setTimeout(() => { load(); }, 5000);
        return;
      }
      setViewing({ item: it, target, url: d.url, name: d.fileName || d.name, watermark: d.watermark, inPage: true, canSave: d.canSave === true, left: typeof d.downloadsLeft === 'number' ? d.downloadsLeft : null, license: d.license || it.license });
    } catch {
      setErr('That couldn’t be opened. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-dvh pb-24">
      <ShopHeader active="account" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4" aria-hidden="true" />
          <h1 className="text-2xl" style={{ fontWeight: 'var(--shop-head-weight, 500)' as any, letterSpacing: 'var(--shop-head-track, -0.02em)' }}>{gift ? 'Your gift' : 'Your library'}</h1>
        </div>
        {gift && !viewing && (
          <section aria-label="About this gift" className="space-y-2 p-5" style={card}>
            <p className="text-[15px] font-semibold">{gift.toName ? `${gift.toName}, ` : ''}{gift.from} sent you this from {gift.shopName || 'the shop'}.</p>
            {gift.message && <p className="whitespace-pre-line text-sm" style={muted}>“{gift.message}”</p>}
          </section>
        )}

        {err && <p role="alert" className="text-sm" style={muted}>{err}</p>}
        {note && <p role="status" className="text-sm" style={muted}>{note}</p>}

        {viewing ? (
          <section aria-label={viewing.name} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-base font-semibold">{viewing.name}</p>
              <button type="button" onClick={() => setViewing(null)} className="inline-flex h-11 shrink-0 items-center px-5 text-sm font-semibold" style={outline}>Close</button>
            </div>
            {viewing.inPage ? (
              <>
                <div className="relative overflow-hidden" style={card}>
                  <iframe src={viewing.url} title={viewing.name} className="h-[70vh] w-full bg-white" />
                  <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-wrap items-center justify-center gap-10 opacity-[0.14]">
                    {[0, 1, 2, 3, 4, 5].map((i) => <p key={i} className="rotate-[-24deg] text-xs font-semibold" style={{ color: '#121212' }}>{viewing.watermark}</p>)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {viewing.canSave && <a href={viewing.url} target="_blank" rel="noreferrer" className="inline-flex h-11 flex-1 items-center justify-center px-5 text-sm font-semibold" style={outline}>Open full screen</a>}
                  {viewing.canSave && (
                    <button type="button" disabled={viewing.left === 0 || !!busy} onClick={() => open(viewing.item, 'download', viewing.target)} className="inline-flex h-11 flex-1 items-center justify-center px-5 text-sm font-semibold disabled:opacity-50" style={solid}>
                      {viewing.left === null ? 'Save a copy' : viewing.left === 0 ? 'No downloads left' : `Save a copy (${viewing.left} left)`}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-3 p-5" style={card}>
                <p className="text-sm" style={muted}>This file is saved to your device rather than shown here.</p>
                <a href={viewing.url} download className="inline-flex h-11 items-center px-5 text-sm font-semibold" style={solid}>Save the file</a>
              </div>
            )}
            <p className="text-sm" style={muted}>{viewing.license ? `${viewing.license.name}: ${viewing.license.terms} ` : ''}Licensed to {viewing.watermark}, and your name is printed into this file. Viewing here is unlimited{viewing.canSave ? '; saving a copy uses one of your downloads' : ''}. This link works for ten minutes; open it again from here any time.</p>
          </section>
        ) : needCode && verify ? (
          <section aria-labelledby="confirm-heading" className="space-y-4 p-5" style={card}>
            <h2 id="confirm-heading" className="text-lg font-semibold">Confirm it’s you</h2>
            <p className="text-sm" style={muted}>{gift ? `Your gift opens on devices you’ve confirmed. We’ll send a 6-digit code to the email it was sent to${verify.emailMasked ? ` (${verify.emailMasked})` : ''}. This device stays confirmed for 30 days.` : `Your downloads open on devices you’ve confirmed. We’ll send a 6-digit code to the ${verify.emailMasked ? `email on this order (${verify.emailMasked})` : 'contact on this order'}. This device stays confirmed for 30 days.`}</p>
            {!code.id ? (
              <div className="flex flex-wrap gap-2">
                {verify.emailMasked && <button type="button" disabled={code.sending} onClick={() => sendCode('email')} className="inline-flex h-11 items-center px-5 text-sm font-semibold disabled:opacity-50" style={solid}>{code.sending ? 'Sending…' : 'Email me a code'}</button>}
                {verify.canText && <button type="button" disabled={code.sending} onClick={() => sendCode('phone')} className="inline-flex h-11 items-center px-5 text-sm font-semibold disabled:opacity-50" style={outline}>Text me a code{verify.phoneEnding ? ` (ends ${verify.phoneEnding})` : ''}</button>}
              </div>
            ) : (
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); confirmCode(); }}>
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                  Code sent to {code.sentTo}
                  <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code.value} onChange={(e) => setCode((c) => ({ ...c, value: e.target.value.replace(/\D/g, '') }))}
                    className="cf-line h-11 w-40 px-3 text-base tracking-[0.3em]" style={{ borderRadius: 'var(--shop-radius-control)', background: 'var(--shop-surface)', color: 'var(--shop-ink)' }} />
                </label>
                <button type="submit" disabled={code.value.length !== 6 || code.checking} className="inline-flex h-11 items-center px-5 text-sm font-semibold disabled:opacity-50" style={solid}>{code.checking ? 'Checking…' : 'Confirm'}</button>
              </form>
            )}
          </section>
        ) : null}

        {!viewing && (items === null ? (
          <div role="status" className="flex justify-center py-10"><Loader className="h-5 w-5 animate-spin" aria-hidden="true" /><span className="sr-only">Loading your library</span></div>
        ) : items.length > 0 && (
          <ul className="space-y-2">
            {items.map((it) => {
              // An item with several files (or files and a link) lists each one to open (lib/digital-product).
              const parts = it.contents ? [...it.contents.files.map((f) => ({ key: f.id, label: f.name, target: { fileId: f.id } as Target, action: f.inPage ? 'Open' : 'Save' })), ...(it.contents.link ? [{ key: '~link', label: 'Online content', target: { link: true } as Target, action: 'Open' }] : [])] : [];
              if (parts.length > 1) return (
                <li key={it.key} className="p-4" style={card}>
                  <span className="block truncate text-[15px] font-semibold">{it.name}</span>
                  <span className="block text-sm" style={muted}>{statusOf(it.access)}{it.access.open && it.left !== null ? ` · ${it.left} download${it.left === 1 ? '' : 's'} left` : ''}</span>
                  <ul className="mt-3 divide-y" style={{ borderColor: 'var(--shop-line)' }}>
                    {parts.map((p) => (
                      <li key={p.key}>
                        <button type="button" onClick={() => open(it, 'view', p.target)} disabled={!it.access.open || !!busy}
                          className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left text-sm disabled:cursor-not-allowed">
                          <span className="min-w-0 truncate">{p.label}</span>
                          <span className="shrink-0 font-semibold">{busy === `${it.key}${p.key === '~link' ? '~link' : p.key}` ? 'Opening…' : it.access.open ? p.action : ''}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {!it.access.open && !gift && <a href={`/shop/${tenantId}/order/${orderId}`} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4">Message the shop about this</a>}
                </li>
              );
              return (
              <li key={it.key}>
                <button type="button" onClick={() => open(it)} disabled={!it.access.open || !!busy}
                  className="flex min-h-16 w-full items-center justify-between gap-3 p-4 text-left disabled:cursor-not-allowed" style={card}>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{it.name}</span>
                    <span className="block text-sm" style={muted}>{statusOf(it.access)}{it.access.open && it.left !== null ? ` · ${it.left} download${it.left === 1 ? '' : 's'} left` : ''}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold">{busy === it.key ? 'Opening…' : it.access.open ? 'Open' : ''}</span>
                </button>
                {!it.access.open && !gift && <a href={`/shop/${tenantId}/order/${orderId}`} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4">Message the shop about this</a>}
              </li>
              );
            })}
          </ul>
        ))}

        {!viewing && <p className="text-sm" style={muted}>Files open here with your name printed on every page. No website can stop a screen being photographed; the name is what makes a shared copy point back to who shared it.</p>}
      </main>
    </div>
  );
}
