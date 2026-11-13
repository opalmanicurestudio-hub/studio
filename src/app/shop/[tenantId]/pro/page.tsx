'use client';
// ─── /shop/[tenantId]/pro ─────────────────────────────────────────────────────
// SEND YOUR LICENSE ONCE. Some products are for licensed pros only (a product's "Pros only"); a customer sends their
// license here, the shop's team checks it, and from then on orders with that email can include those products until
// it expires (lib/pro-license). Everything is checked again on the server (api/retail/pro-license), the page is limited
// per visitor, and the copy of the license is saved where only the team can open it.
import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { ShopHeader, useShopSite } from '@/components/shop/ShopChrome';
import { STATE_LIST } from '@/lib/wholesale-tax';

const ink = 'var(--shop-ink, #16171a)'; const mutedC = 'var(--shop-muted, #6d7075)'; const line = 'var(--shop-line, #ececee)';
const card = 'var(--shop-card, #fff)'; const brand = 'var(--shop-brand, #16171a)'; const onBrand = 'var(--shop-on-brand, #fff)';
const input = 'mt-1 block h-12 w-full rounded-2xl border px-3.5 text-[16px] font-normal outline-none';
const inStyle: React.CSSProperties = { borderColor: line, background: card, color: ink };
// One address, as the server takes it (lib/pro-license's EMAIL; that file is server only).
const EMAIL = /^[^\s@,;<>"()\\[\]:]+@[^\s@,;<>"()\\[\]:]+\.[^\s@,;<>"()\\[\]:]{2,}$/;

function readFile(f: File): Promise<string> {
  return new Promise((res, rej) => {
    if (f.size > 3 * 1024 * 1024) { rej(new Error('Keep the copy under 3 MB.')); return; }
    const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => rej(new Error('That file couldn’t be read.')); r.readAsDataURL(f);
  });
}

export default function ProLicensePage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = React.use(params);
  const site = useShopSite();
  const [info, setInfo] = useState<{ open: boolean; shopName: string } | null>(null);
  const [f, setF] = useState({ name: '', email: '', phone: '', number: '', state: '', expiresOn: '', hp: '' });
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const openedAt = React.useRef(Date.now());
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [sent, setSent] = useState<string | null>(null);
  const shopName = info?.shopName || site?.name || 'The shop';

  useEffect(() => {
    fetch(`/api/retail/pro-license?tenantId=${encodeURIComponent(tenantId)}`).then((r) => r.json()).then((d) => setInfo({ open: d.open === true, shopName: String(d.shopName || '') })).catch(() => setInfo({ open: false, shopName: '' }));
  }, [tenantId]);

  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const send = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/retail/pro-license', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...f, ms: Date.now() - openedAt.current, ...(file ? { file: file.data, fileName: file.name } : {}) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setErr(d.error || 'That didn’t go through. Try again.'); return; }
      setSent(String(d.message || 'Sent.'));
      window.scrollTo({ top: 0 });
    } catch { setErr('That didn’t reach the shop. Check your connection and try again.'); } finally { setBusy(false); }
  };
  // (Today on their own calendar, so a license good through today can still be sent this evening.)
  const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const ready = f.name.trim() && EMAIL.test(f.email.trim().toLowerCase()) && f.number.trim().length >= 3 && f.state && /^\d{4}-\d{2}-\d{2}$/.test(f.expiresOn) && !!file;
  const firstName = f.name.trim().split(' ')[0];

  return (
    <div style={{ color: ink, fontFamily: 'var(--shop-font, inherit)' }}>
      <ShopHeader minimal />
      <main className="mx-auto max-w-md px-4 pb-16 pt-6">
        {sent ? (
          <>
            <h1 className="m-0 text-[28px] font-light tracking-[-0.02em]">Thanks{firstName ? `, ${firstName}` : ''}</h1>
            <p className="m-0 mt-1 text-[16px]">Your license is with {shopName}.</p>
            <ol className="m-0 mt-5 list-none space-y-3 rounded-[20px] border p-4" style={{ borderColor: line, background: card }}>
              <li className="flex gap-3 text-[15px]"><span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ink }} />Sent today</li>
              <li className="flex gap-3 text-[15px]" style={{ color: mutedC }}><span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: line }} />{shopName} checks it</li>
              <li className="flex gap-3 text-[15px]" style={{ color: mutedC }}><span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: line }} />You get an email at {f.email.trim()} with a link to sign in. Signed in, your orders can include products for pros</li>
            </ol>
            <Link href={`/shop/${tenantId}`} className="mt-5 flex h-12 items-center justify-center rounded-full text-[15px] font-semibold" style={{ background: 'var(--shop-brand-soft, #f5f5f7)', color: ink }}>Back to the shop</Link>
          </>
        ) : info && !info.open ? (
          <>
            <h1 className="m-0 text-[28px] font-light tracking-[-0.02em]">Your license</h1>
            <p className="m-0 mt-1 text-[16px]">{shopName} isn’t taking licenses here right now.</p>
          </>
        ) : (
          <>
            <h1 className="m-0 text-[28px] font-light tracking-[-0.02em]">Send your license</h1>
            <p className="m-0 mt-1 text-[15px]" style={{ color: mutedC }}>Some products are for licensed pros only. Send your license once; {shopName} checks it, and your orders can include them until it expires.</p>
            <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void send(); }}>
              <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>Name on your license<input required value={f.name} onChange={(e) => set('name', e.target.value.slice(0, 80))} autoComplete="name" className={input} style={inStyle} /></label>
              <div className="grid grid-cols-[1.4fr_1fr] gap-2">
                <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>Email you order with<input required type="email" value={f.email} onChange={(e) => set('email', e.target.value.slice(0, 160))} autoComplete="email" className={input} style={inStyle} /></label>
                <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>Phone<input value={f.phone} onChange={(e) => set('phone', e.target.value.slice(0, 30))} inputMode="tel" autoComplete="tel" placeholder="Optional" className={input} style={inStyle} /></label>
              </div>
              <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>License number<input required value={f.number} onChange={(e) => set('number', e.target.value.slice(0, 40))} autoComplete="off" className={input} style={inStyle} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>State
                  <select required value={f.state} onChange={(e) => set('state', e.target.value)} className={input} style={inStyle}><option value="">Choose</option>{STATE_LIST.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
                <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>Expires<input required type="date" min={today} value={f.expiresOn} onChange={(e) => set('expiresOn', e.target.value)} className={input} style={inStyle} /></label>
              </div>
              <div className="rounded-[18px] border p-3" style={{ borderColor: line, background: card }}>
                <p className="m-0 text-[15px] font-semibold">A photo of your license</p>
                <p className="m-0 text-[13px]" style={{ color: mutedC }}>Only {shopName}’s team sees it. A photo or a PDF, under 3 MB.</p>
                <label className="mt-2 inline-flex h-12 cursor-pointer items-center rounded-full px-4 text-[15px] font-semibold focus-within:outline focus-within:outline-2 focus-within:outline-offset-2" style={{ background: 'var(--shop-brand-soft, #f5f5f7)' }}>
                  {file ? 'Replace' : 'Add a photo'}
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={async (e) => { const x = e.target.files?.[0]; if (!x) return; try { setFile({ name: x.name.slice(0, 120), data: await readFile(x) }); setErr(''); } catch (er: any) { setErr(er?.message || 'That file couldn’t be read.'); } }} />
                </label>
                {file && <p className="m-0 mt-2 text-[14px]">{file.name} <button type="button" onClick={() => setFile(null)} className="ml-2 h-11 font-semibold underline underline-offset-4">Remove</button></p>}
              </div>
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><input tabIndex={-1} name="cf_extra_field" autoComplete="new-password" value={f.hp} onChange={(e) => set('hp', e.target.value)} /></div>
              {err && <p role="alert" className="m-0 text-[15px]" style={{ color: '#b45309' }}>{err}</p>}
              <button type="submit" disabled={busy || !ready} className="h-12 w-full rounded-full text-[16px] font-semibold disabled:opacity-50" style={{ background: brand, color: onBrand }}>{busy ? 'Sending…' : 'Send my license'}</button>
              <p className="m-0 text-center text-[13px]" style={{ color: mutedC }}>You’ll hear back by email.</p>
            </form>
          </>
        )}
      </main>
    </div>);
}
