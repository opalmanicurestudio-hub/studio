'use client';
// src/app/(app)/settings/setup/page.tsx — SET UP YOUR BUSINESS. The steps a new owner goes through, chosen from the
// tools the business uses (lib/setup-guide), each opening the real page with a Skip / Next bar at the bottom. Beside
// them: the booking link (copy, QR code) and a starter menu of common services for the kind of business. This page
// replaces Getting started.
import * as React from 'react';
import Link from 'next/link';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';
import { C, LargeTitle } from '@/components/orders/ui';
import { useSetupGuide } from '@/components/settings/SetupGuide';
import { useSettingsBack } from '@/components/settings/settings-place';
import { stepHref, type GuideStep } from '@/lib/setup-guide';

function StepRow({ s, n, last }: { s: GuideStep; n: number; last: boolean }) {
  return (
    <Link href={stepHref(s)} className="flex min-h-[68px] items-center gap-3 pl-4 transition-colors hover:brightness-[0.98]">
      {s.done
        ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: C.okSoft }}><Check className="h-4 w-4" style={{ color: C.ok }} aria-label="Done" /></span>
        : <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold" style={{ border: `2px solid ${s.skipped ? C.warn : C.line}`, color: C.muted }}>{n}</span>}
      <span className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pr-4" style={last ? undefined : { borderBottom: `1px solid ${C.line}` }}>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] tracking-[-0.01em]">{s.title}</span>
          <span className="mt-0.5 block text-[13px] leading-snug" style={{ color: s.skipped ? C.warn : C.muted }}>{s.skipped ? 'Skipped for now' : s.note || s.meaning}</span>
        </span>
        <span className="shrink-0 text-[14px] font-medium" style={{ color: s.done ? C.muted : C.ink }}>{s.done ? 'Open' : 'Start'}</span>
        <ChevronRight className="h-4 w-4 shrink-0" style={{ color: C.muted }} aria-hidden />
      </span>
    </Link>
  );
}

export default function SetupPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId = selectedTenant?.id || '';
  const back = useSettingsBack();
  const g = useSetupGuide(true);
  const [menu, setMenu] = React.useState(''); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState('');
  const [copied, setCopied] = React.useState(false); const [qr, setQr] = React.useState<string | null>(null);
  // Another business: its own link, menu and messages.
  React.useEffect(() => { setQr(null); setMenu(''); setMsg(''); setCopied(false); }, [tenantId]);
  // Off Settings either way: hidden by the owner, or noted as finished earlier (Show brings it back from both).
  const hidden = !!(selectedTenant?.setupGuide?.hidden || selectedTenant?.setupGuide?.finishedAt);
  const [hideBusy, setHideBusy] = React.useState(false); const [hideErr, setHideErr] = React.useState('');
  const toggleHidden = async () => { if (hideBusy) return; setHideBusy(true); setHideErr(''); const ok = await g.mark('', hidden ? 'show' : 'hide'); setHideBusy(false); if (!ok) setHideErr('That didn’t save. Try again.'); };
  React.useEffect(() => { if (g.data && !menu && g.data.suggest) setMenu(g.data.suggest); }, [g.data, menu]);   // nothing picked when no starter menu fits
  const link = typeof window !== 'undefined' && g.data ? `${window.location.origin}${g.data.bookingPath}` : '';
  const addMenu = async () => {
    setBusy(true); setMsg('');
    const r: any = await payPost('/api/getting-started', { tenantId, action: 'starter', menu });
    setBusy(false); setMsg(!r?.ok ? r?.error || 'That didn’t work. Try again.' : r.added === 0 ? 'These are all on your list already.' : `${r.added} service${r.added === 1 ? '' : 's'} added. Set your prices, then switch each one on.`);
    if (r?.ok) void g.reload();
  };
  const forTenant = React.useRef(tenantId); forTenant.current = tenantId;
  const showQr = async () => { if (qr) { setQr(null); return; } const was = tenantId; try { const QR: any = await import('qrcode'); const url = await QR.toDataURL(link, { margin: 1, width: 360 }); if (forTenant.current === was) setQr(url); } catch { setQr(null); } };
  const p = g.progress;

  return (
    <div className="cf-settings min-h-full">
      <AppHeader title="Settings" />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-5 md:px-10 md:pt-10" style={{ color: C.ink }}>
        <Link href={back.href} className="mb-3 inline-flex h-11 items-center gap-1 text-[17px] lg:hidden" style={{ color: C.ink }}><ChevronLeft className="h-5 w-5" aria-hidden />{back.label}</Link>
        {!g.ready ? <p className="text-[15px]" style={{ color: C.muted }}>Loading…</p> : !g.allowed ? <p className="text-[15px]" style={{ color: C.muted }}>Setting up the business is for owners and managers.</p> : g.failed ? (
          <div className="space-y-3"><p className="text-[15px]" style={{ color: C.muted }}>Your steps didn’t load. Check your connection and try again.</p>
            <button type="button" onClick={() => void g.reload()} className="h-11 rounded-full px-5 text-[14.5px] font-semibold" style={{ background: C.ink, color: C.paper }}>Try again</button></div>
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.5fr_1fr]">
            <div className="min-w-0">
              <LargeTitle title={p && p.doneCount === p.total ? 'You’re all set' : 'Set up your business'} sub={!p ? 'Loading…' : p.doneCount === p.total ? 'Every step is done. Each one still opens its page if you want to change something.' : p.finished ? `${p.doneCount} of ${p.total} done. The rest are put off for later, whenever you’re ready.` : `${p.doneCount} of ${p.total} done. Each step opens the real page, with good choices already made.`} />
              {p && <div className="mt-4 h-1.5 overflow-hidden rounded-full" style={{ background: C.soft }} role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.doneCount} aria-valuetext={`${p.doneCount} of ${p.total} done`} aria-label="Setup progress">
                <div className="h-full rounded-full" style={{ width: `${(p.doneCount / Math.max(1, p.total)) * 100}%`, background: C.ok }} /></div>}
              {p?.next && <Link href={stepHref(p.next)} className="mt-6 inline-flex h-12 items-center rounded-full px-6 text-[15.5px] font-semibold" style={{ background: C.ink, color: C.paper }}>{p.doneCount ? 'Continue' : 'Start'}: {p.next.title}</Link>}
              {g.steps && <div className="mt-6 overflow-hidden rounded-2xl" style={{ background: C.soft }}>{g.steps.map((s, i) => <StepRow key={s.id} s={s} n={i + 1} last={i === g.steps!.length - 1} />)}</div>}
              <p className="mt-4 text-[13.5px]" style={{ color: C.muted }}>Moving from another app? <Link href="/import" className="inline-flex min-h-11 items-center underline underline-offset-4">Bring your clients and records over</Link></p>
              {g.steps && !p?.allDone && <button type="button" aria-disabled={hideBusy} onClick={() => void toggleHidden()} className="mt-1 inline-flex h-11 items-center text-[13.5px] font-medium underline-offset-4 hover:underline aria-disabled:opacity-50" style={{ color: C.muted }}>{hidden ? 'Show this in Settings again' : 'Hide this from Settings'}</button>}
              {hideErr && <p role="alert" className="text-[13px] font-semibold" style={{ color: C.warn }}>{hideErr}</p>}
            </div>
            <div className="min-w-0 space-y-4">
              {g.data && <div className="space-y-3 rounded-2xl p-5" style={{ background: C.soft }}>
                <p className="text-[13px] font-semibold" style={{ color: C.muted }}>Your booking link</p>
                <p className="break-all text-[16px] font-semibold">{link.replace(/^https?:\/\//, '')}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { window.prompt('Your booking link', link); } }} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: C.ink, color: C.paper }}>{copied ? 'Copied' : 'Copy link'}</button>
                  <button type="button" onClick={showQr} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: C.paper, color: C.ink, boxShadow: `inset 0 0 0 1px ${C.line}` }}>{qr ? 'Hide QR code' : 'QR code'}</button>
                  <Link href="/settings/booking-page" onClick={() => void payPost('/api/getting-started', { tenantId, action: 'page-seen' })} className="inline-flex h-11 items-center rounded-full px-4 text-[14px] font-semibold" style={{ background: C.paper, color: C.ink, boxShadow: `inset 0 0 0 1px ${C.line}` }}>Design your page</Link>
                </div>
                {qr && <div className="space-y-2"><img src={qr} alt="QR code for your booking link" className="mx-auto h-44 w-44" /><a href={qr} download="booking-qr.png" className="flex min-h-11 items-center justify-center text-[13px] font-semibold underline underline-offset-4">Download the QR code</a></div>}
              </div>}
              {g.data && g.data.facts.livePriced === 0 && <div className="space-y-3 rounded-2xl p-5" style={{ background: C.soft }}>
                <p className="text-[14px]"><b>Start from a menu.</b> Common services for your kind of business, with typical lengths. Prices are left to you: each one goes on your booking page when you give it a price.</p>
                <select value={menu} onChange={(e) => setMenu(e.target.value)} aria-label="Starter menu" className="h-11 w-full rounded-xl px-3 text-[14.5px]" style={{ background: C.paper, color: C.ink, boxShadow: `inset 0 0 0 1px ${C.line}` }}>
                  {!menu && <option value="" disabled>Choose a starter menu</option>}
                  {g.data.menus.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.count} services</option>)}
                </select>
                <button type="button" disabled={busy || !menu} onClick={addMenu} className="h-11 w-full rounded-full text-[14.5px] font-semibold disabled:opacity-50" style={{ background: C.ink, color: C.paper }}>{busy ? 'Adding…' : g.data.starterMenu ? 'Add any that are missing' : 'Add these services'}</button>
                {msg && <p className="text-[13.5px] font-semibold" style={{ color: C.ok }}>{msg}{msg.includes('added') && <> <Link href="/services" className="underline underline-offset-4">Open services</Link></>}</p>}
              </div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
