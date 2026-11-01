'use client';
// ─── /shop/[tenantId]/wholesale ──────────────────────────────────────────────
// APPLY FOR WHOLESALE, AND USE YOUR CODE. A salon, spa or shop buying to resell applies here (when the shop takes
// applications: Wholesale › Settings); the answers wait in the shop's Wholesale until someone approves, which emails
// them a code. That email links back here with ?code= and a signed-in session for their email (lib/retail-account),
// which checks the code, signs them in on this device (tax-free orders need it) and opens the shop at wholesale prices.
// Everything is checked again on the server (api/retail/wholesale-apply), and the page is limited per visitor.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { ShopHeader, useShopSite } from '@/components/shop/ShopChrome';
import { writeWholesaleCode } from '@/lib/shop-cart';
import { STATE_LIST, stateName } from '@/lib/wholesale-tax';

const ink = 'var(--shop-ink, #16171a)'; const mutedC = 'var(--shop-muted, #6d7075)'; const line = 'var(--shop-line, #ececee)';
const card = 'var(--shop-card, #fff)'; const brand = 'var(--shop-brand, #16171a)'; const onBrand = 'var(--shop-on-brand, #fff)';
const input = 'mt-1 block h-12 w-full rounded-2xl border px-3.5 text-[16px] font-normal outline-none';
const inStyle: React.CSSProperties = { borderColor: line, background: card, color: ink };
const KINDS = [['salon', 'Salon'], ['spa', 'Spa'], ['shop', 'Shop'], ['other', 'Other']] as const;

function readFile(f: File): Promise<string> {
  return new Promise((res, rej) => {
    if (f.size > 3 * 1024 * 1024) { rej(new Error('Keep the copy under 3 MB.')); return; }
    const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => rej(new Error('That file couldn’t be read.')); r.readAsDataURL(f);
  });
}

export default function WholesaleApplyPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = React.use(params);
  const site = useShopSite();
  const router = useRouter();
  const [info, setInfo] = useState<{ open: boolean; shopName: string } | null>(null);
  const [code, setCode] = useState(''); const [codeMode, setCodeMode] = useState(false);
  const [f, setF] = useState({ businessName: '', contactName: '', phone: '', email: '', kind: 'salon', state: '', website: '', certNumber: '', note: '', hp: '' });
  const openedAt = React.useRef(Date.now());
  const sess = React.useRef<{ e: string; x: number; s: string } | null>(null);
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [sent, setSent] = useState<string | null>(null);
  const shopName = info?.shopName || site?.name || 'The shop';

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const c = qs.get('code') || '';
    if (c) { setCode(c.toUpperCase().slice(0, 40)); setCodeMode(true); }
    const e = qs.get('e') || ''; const x = Number(qs.get('x')); const sg = qs.get('s') || '';
    if (e && Number.isFinite(x) && x > Date.now() && /^[0-9a-f]{64}$/.test(sg)) sess.current = { e: e.toLowerCase(), x, s: sg };
    fetch(`/api/retail/wholesale-apply?tenantId=${encodeURIComponent(tenantId)}`).then((r) => r.json()).then((d) => setInfo({ open: d.open === true, shopName: String(d.shopName || '') })).catch(() => setInfo({ open: false, shopName: '' }));
  }, [tenantId]);

  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const tryCode = async () => {
    const c = code.trim(); if (!c) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/retail/wholesale-apply?tenantId=${encodeURIComponent(tenantId)}&code=${encodeURIComponent(c)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setErr(d.error || 'That code didn’t work. Check it against your email.'); return; }
      writeWholesaleCode(tenantId, c.toUpperCase());
      // The link's sign-in, kept as the shop's account pages keep it; the server checks it every time it's used.
      if (sess.current) { try { localStorage.setItem(`cfshop-acct-${tenantId}`, JSON.stringify(sess.current)); } catch { /* private mode */ } }
      // Replaced, not pushed: the link's sign-in doesn't stay in this page's history.
      router.replace(`/shop/${tenantId}`);
    } catch { setErr('That didn’t reach the shop. Check your connection and try again.'); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/retail/wholesale-apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...f, ms: Date.now() - openedAt.current, ...(file ? { certFile: file.data, certFileName: file.name } : {}) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setErr(d.error || 'That didn’t go through. Try again.'); return; }
      setSent(String(d.message || 'Sent.'));
      window.scrollTo({ top: 0 });
    } catch { setErr('That didn’t reach the shop. Check your connection and try again.'); } finally { setBusy(false); }
  };
  const ready = f.businessName.trim().length >= 2 && f.contactName.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim()) && f.state;
  const firstName = f.contactName.trim().split(' ')[0];

  return (
    <div style={{ color: ink, fontFamily: 'var(--shop-font, inherit)' }}>
      <ShopHeader minimal />
      <main className="mx-auto max-w-md px-4 pb-16 pt-6">
        {sent ? (
          <>
            <h1 className="m-0 text-[28px] font-light tracking-[-0.02em]">Thanks{firstName ? `, ${firstName}` : ''}</h1>
            <p className="m-0 mt-1 text-[16px]">Your application for {f.businessName.trim()} is with {shopName}.</p>
            <ol className="m-0 mt-5 list-none space-y-3 rounded-[20px] border p-4" style={{ borderColor: line, background: card }}>
              <li className="flex gap-3 text-[15px]"><span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ink }} />Sent today{file || f.certNumber.trim() ? `, with your ${stateName(f.state)} resale certificate` : ''}</li>
              <li className="flex gap-3 text-[15px]" style={{ color: mutedC }}><span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: line }} />{shopName} looks at it</li>
              <li className="flex gap-3 text-[15px]" style={{ color: mutedC }}><span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: line }} />You get your wholesale code at {f.email.trim()}</li>
            </ol>
            <p className="m-0 mt-4 text-[14px]" style={{ color: mutedC }}>{sent === 'Sent.' ? 'Nothing to pay and nothing to set up.' : sent}</p>
            <Link href={`/shop/${tenantId}`} className="mt-5 flex h-12 items-center justify-center rounded-full text-[15px] font-semibold" style={{ background: 'var(--shop-brand-soft, #f5f5f7)', color: ink }}>Back to the shop</Link>
          </>
        ) : codeMode ? (
          <>
            <h1 className="m-0 text-[28px] font-light tracking-[-0.02em]">Your wholesale code</h1>
            <p className="m-0 mt-1 text-[15px]" style={{ color: mutedC }}>Use it once here and {shopName} shows you wholesale prices on this device.</p>
            <label className="mt-5 block text-[13px] font-semibold" style={{ color: mutedC }}>Code<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 40))} autoComplete="off" className={`${input} tracking-[0.06em]`} style={inStyle} /></label>
            {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: '#b45309' }}>{err}</p>}
            <button type="button" disabled={busy || !code.trim()} onClick={() => void tryCode()} className="mt-4 h-12 w-full rounded-full text-[16px] font-semibold disabled:opacity-50" style={{ background: brand, color: onBrand }}>{busy ? 'Checking…' : 'Start shopping at wholesale prices'}</button>
            {info?.open && <button type="button" onClick={() => { setCodeMode(false); setErr(''); }} className="mt-2 h-11 w-full text-[15px] font-semibold underline underline-offset-4">No code yet? Apply for wholesale</button>}
          </>
        ) : info && !info.open ? (
          <>
            <h1 className="m-0 text-[28px] font-light tracking-[-0.02em]">Wholesale</h1>
            <p className="m-0 mt-1 text-[16px]">{shopName} isn’t taking wholesale applications here right now.</p>
            <button type="button" onClick={() => setCodeMode(true)} className="mt-5 h-12 w-full rounded-full text-[15px] font-semibold" style={{ background: 'var(--shop-brand-soft, #f5f5f7)', color: ink }}>I have a code</button>
          </>
        ) : (
          <>
            <h1 className="m-0 text-[28px] font-light tracking-[-0.02em]">Apply for wholesale</h1>
            <p className="m-0 mt-1 text-[15px]" style={{ color: mutedC }}>For salons, spas and shops buying to resell. {shopName} looks at each one and emails you a code.</p>
            <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void send(); }}>
              <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>Business name<input required value={f.businessName} onChange={(e) => set('businessName', e.target.value.slice(0, 120))} autoComplete="organization" className={input} style={inStyle} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>Your name<input required value={f.contactName} onChange={(e) => set('contactName', e.target.value.slice(0, 80))} autoComplete="name" className={input} style={inStyle} /></label>
                <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>Phone<input value={f.phone} onChange={(e) => set('phone', e.target.value.slice(0, 30))} inputMode="tel" autoComplete="tel" placeholder="Optional" className={input} style={inStyle} /></label>
              </div>
              <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>Email<input required type="email" value={f.email} onChange={(e) => set('email', e.target.value.slice(0, 160))} autoComplete="email" className={input} style={inStyle} /></label>
              <div role="group" aria-label="What kind of business">
                <p className="m-0 text-[13px] font-semibold" style={{ color: mutedC }}>What kind of business</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {KINDS.map(([id, label]) => <button key={id} type="button" aria-pressed={f.kind === id} onClick={() => set('kind', id)} className="h-11 rounded-full px-4 text-[15px] font-semibold" style={f.kind === id ? { background: ink, color: card } : { background: card, color: ink, boxShadow: `inset 0 0 0 1px ${line}` }}>{label}</button>)}
                </div>
              </div>
              <div className="grid grid-cols-[1fr_1.3fr] gap-2">
                <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>State
                  <select required value={f.state} onChange={(e) => set('state', e.target.value)} className={input} style={inStyle}><option value="">Choose</option>{STATE_LIST.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
                <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>Website or Instagram<input value={f.website} onChange={(e) => set('website', e.target.value.slice(0, 200))} placeholder="Optional" className={input} style={inStyle} /></label>
              </div>
              <div className="rounded-[18px] border p-3" style={{ borderColor: line, background: card }}>
                <p className="m-0 text-[15px] font-semibold">Resale certificate</p>
                <p className="m-0 text-[13px]" style={{ color: mutedC }}>Optional. Add it to buy without sales tax. You can send it later.</p>
                <div className="mt-2 flex items-end gap-2">
                  <label className="block min-w-0 flex-1 text-[13px] font-semibold" style={{ color: mutedC }}>Certificate number<input value={f.certNumber} onChange={(e) => set('certNumber', e.target.value.slice(0, 40))} className={input} style={inStyle} /></label>
                  <label className="inline-flex h-12 shrink-0 cursor-pointer items-center rounded-full px-4 text-[15px] font-semibold" style={{ background: 'var(--shop-brand-soft, #f5f5f7)' }}>
                    {file ? 'Replace' : 'Add a copy'}
                    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={async (e) => { const x = e.target.files?.[0]; if (!x) return; try { setFile({ name: x.name.slice(0, 120), data: await readFile(x) }); setErr(''); } catch (er: any) { setErr(String(er?.message || 'That file couldn’t be read.')); } }} />
                  </label>
                </div>
                {file && <p className="m-0 mt-2 text-[14px]">{file.name} · <button type="button" onClick={() => setFile(null)} className="h-11 font-semibold underline underline-offset-4">Remove</button></p>}
              </div>
              <label className="block text-[13px] font-semibold" style={{ color: mutedC }}>Anything we should know<input value={f.note} onChange={(e) => set('note', e.target.value.slice(0, 500))} placeholder="Optional" className={input} style={inStyle} /></label>
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><input tabIndex={-1} name="cf_extra_field" autoComplete="new-password" value={f.hp} onChange={(e) => set('hp', e.target.value)} /></div>
              {err && <p role="alert" className="m-0 text-[15px]" style={{ color: '#b45309' }}>{err}</p>}
              <button type="submit" disabled={busy || !ready} className="h-12 w-full rounded-full text-[16px] font-semibold disabled:opacity-50" style={{ background: brand, color: onBrand }}>{busy ? 'Sending…' : 'Send application'}</button>
              <p className="m-0 text-center text-[13px]" style={{ color: mutedC }}>You’ll hear back by email. Already have a code? <button type="button" onClick={() => { setCodeMode(true); setErr(''); }} className="h-11 font-semibold underline underline-offset-4" style={{ color: ink }}>Use it here</button></p>
            </form>
          </>
        )}
      </main>
    </div>);
}
