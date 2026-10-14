'use client';
// src/app/(app)/getting-started/page.tsx — STARTING FRESH: the six steps to taking bookings (/api/getting-started).
// Each step is read from what's really set up — nothing to tick by hand. "Your services" can start from a common menu
// for the kind of business (lib/starter-menus): hidden and unpriced until the business sets its own prices.
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', GREEN = '#1f7a4d';
const card = { background: 'hsl(var(--card))', border: `1px solid ${LINE}`, borderRadius: 18 } as const;
const STEPS: Record<string, { title: string; sub: string; href: string; cta: string }> = {
  services: { title: 'Your services', sub: 'Start from a common menu and set your prices, or add your own.', href: '/services', cta: 'Add' },
  hours: { title: 'Your hours', sub: 'When you’re open and when each person works.', href: '/settings?tab=hours', cta: 'Set' },
  team: { title: 'Your team', sub: 'Add people now or later — they get the staff app.', href: '/staff', cta: 'Add' },
  payments: { title: 'Take payments', sub: 'Connect your bank to take cards — about 5 minutes.', href: '/settings?tab=payments', cta: 'Connect' },
  page: { title: 'Your booking page', sub: 'Your link is ready — choose your look.', href: '/settings/booking', cta: 'Open' },
  clients: { title: 'Your first clients', sub: 'Add them as they book — or bring them over from another app later.', href: '/clients', cta: 'Add' },
};

export default function GettingStartedPage() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [d, setD] = React.useState<any>(null); const [menu, setMenu] = React.useState(''); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState('');
  const [copied, setCopied] = React.useState(false); const [qr, setQr] = React.useState<string | null>(null);
  const load = React.useCallback(() => { if (tenantId && isManager) payPost('/api/getting-started', { tenantId, action: 'status' }).then((r) => { if (r.ok) { setD(r); setMenu((m) => m || r.suggest); } }); }, [tenantId, isManager]);
  React.useEffect(() => { load(); }, [load]);
  if (!isManager) return <div className="p-6"><AppHeader title="Getting started" /><p className="mt-6" style={{ color: MUTED }}>This is for managers.</p></div>;
  const link = typeof window !== 'undefined' && d ? `${window.location.origin}${d.bookingPath}` : '';
  const addMenu = async () => { setBusy(true); setMsg(''); const r = await payPost('/api/getting-started', { tenantId, action: 'starter', menu }); setBusy(false); setMsg(r.ok ? `${r.added} services added — set your prices, then switch each one on.` : r.error || 'That didn’t work.'); load(); };
  const showQr = async () => { if (qr) { setQr(null); return; } try { const QR: any = await import('qrcode'); setQr(await QR.toDataURL(link, { margin: 1, width: 360 })); } catch { setQr(null); } };
  const svcStep = d?.steps?.find((s: any) => s.key === 'services');
  return (
    <div className="min-h-screen" style={{ color: INK, backgroundColor: 'hsl(var(--background))', backgroundImage: 'radial-gradient(120% 80% at 8% -5%, #e5e5ec 0%, transparent 55%)' }}>
      <AppHeader title="Getting started" />
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-6 p-4 md:p-8 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-4">
          <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>starting fresh</p>
            <h1 className="text-[36px] font-normal tracking-[-0.03em]">{d && d.done === 6 ? 'You’re all set' : 'Let’s set you up'}</h1>
            <p className="text-[14.5px]" style={{ color: MUTED }}>{d ? `${d.done} of 6 done.` : ''} Six short steps — most people are taking bookings in under 20 minutes.</p></div>
          <div className="overflow-hidden" style={card}>
            {!d ? <p className="p-5" style={{ color: MUTED }}>Loading…</p> : d.steps.map((s: any, i: number) => { const x = STEPS[s.key]; return (
              <div key={s.key} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-3.5" style={{ borderTop: i ? `1px solid ${LINE}` : 'none' }}>
                <span className="flex h-6 w-6 items-center justify-center rounded-full" style={s.done ? { background: GREEN } : { border: '1.5px dashed hsl(var(--border))' }}>{s.done && <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2.5 6.2l2.3 2.3 4.7-4.9" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
                <span className="min-w-0"><span className="block text-[15.5px] font-semibold">{x.title}</span><span className="block text-[13px] leading-snug" style={{ color: MUTED }}>{s.note || x.sub}</span></span>
                <a href={x.href} onClick={() => { if (s.key === 'page') void payPost('/api/getting-started', { tenantId, action: 'page-seen' }); }} className="inline-flex h-10 items-center rounded-full px-4 text-[14px] font-semibold" style={s.done ? { border: `1px solid ${LINE}`, background: 'hsl(var(--card))' } : { background: INK, color: 'hsl(var(--background))' }}>{s.done ? (s.key === 'services' && svcStep?.note?.includes('need a price') ? 'Set prices' : 'Done') : x.cta}</a>
              </div>); })}
          </div>
          <p className="text-[13.5px]" style={{ color: MUTED }}>Changed your mind? <a href="/import" className="underline underline-offset-4">Bring records from another app instead</a></p>
        </div>
        <div className="space-y-4">
          <div className="space-y-3 p-5" style={card}><p className="text-[13px]" style={{ color: MUTED }}>Your booking link</p><p className="break-all text-[16px] font-semibold">{link.replace(/^https?:\/\//, '')}</p>
            <div className="flex gap-2"><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { window.prompt('Your booking link', link); } }} className="h-10 rounded-full border px-4 text-[14px] font-semibold" style={{ borderColor: LINE }}>{copied ? 'Copied' : 'Copy'}</button>
              <button type="button" onClick={showQr} className="h-10 rounded-full border px-4 text-[14px] font-semibold" style={{ borderColor: LINE }}>{qr ? 'Hide QR code' : 'QR code'}</button></div>
            {qr && <div className="space-y-2"><img src={qr} alt="QR code for your booking link" className="mx-auto h-44 w-44" /><a href={qr} download="booking-qr.png" className="block text-center text-[13px] font-semibold underline underline-offset-4">Download it for a sign or your counter</a></div>}</div>
          {d && <div className="space-y-3 rounded-[18px] p-5" style={{ background: SOFT }}>
            <p className="text-[14px]"><b>Your menu, to start:</b> common services with typical lengths. Prices are left for you — nothing shows on your booking page until you set a price and switch it on.</p>
            <select value={menu} onChange={(e) => setMenu(e.target.value)} aria-label="Starter menu" className="h-11 w-full rounded-xl border bg-card px-3 text-[14.5px]" style={{ borderColor: LINE }}>{d.menus.map((m: any) => <option key={m.id} value={m.id}>{m.label} — {m.count} services</option>)}</select>
            <button type="button" disabled={busy} onClick={addMenu} className="h-11 w-full rounded-full text-[14.5px] font-semibold text-background disabled:opacity-50" style={{ background: INK }}>{busy ? 'Adding…' : d.starterMenu ? 'Add any that are missing' : 'Add this menu'}</button>
            {msg && <p className="text-[13.5px] font-semibold" style={{ color: GREEN }}>{msg}{msg.includes('added') && <> <a href="/services" className="underline underline-offset-4">Open services</a></>}</p>}</div>}
        </div>
      </main>
    </div>);
}
