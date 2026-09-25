'use client';
// src/app/(app)/subscriptions/page.tsx
//
// YOUR CLARITYFLOW — the step after sign-up (the app sends new owners here
// until they're active), and the place to change tools later.
//
// It replaces the old three-plan page, which recorded a "tier" without taking
// any payment. Now: the tools they chose, editable; an honest early-access
// note (everything included; when plans launch, you pay only for what you
// keep on); and one button that saves the tools to tenant.modules — which
// the sidebar reads — and opens the app.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { collection, query, where } from 'firebase/firestore';
import { Loader } from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { AuthBackdrop, Wordmark } from '@/components/auth/AuthBackdrop';
import { ToolPicker } from '@/components/modules/ToolPicker';
import { fromTenantModules, hoursFor, RECOMMENDED, TOOL_BY_ID, type ToolId } from '@/lib/module-catalog';

export default function YourClarityFlowPage() {
  const { user, firestore } = useFirebase();
  const router = useRouter();
  const q = useMemoFirebase(() => (user && firestore ? query(collection(firestore, 'tenants'), where('userId', '==', user.uid)) : null), [user, firestore]);
  const { data: tenants, isLoading } = useCollection<any>(q);
  const tenant = tenants?.[0];
  const [tools, setTools] = useState<ToolId[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isNew = tenant && tenant.subscriptionStatus !== 'active';
  // Billing: the live monthly price for these tools, and the subscription.
  const [bill, setBill] = useState<any>(null);
  const [notice, setNotice] = useState('');
  const billingApi = async (body: any) => {
    const tk = user ? await user.getIdToken() : '';
    const r = await fetch('/api/billing', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ tenantId: tenant?.id, ...body }) });
    return r.json().catch(() => ({ ok: false }));
  };
  useEffect(() => {
    if (!tenant || !tools || !user) return;
    const t = window.setTimeout(() => { billingApi({ action: 'status', tools }).then((r) => r.ok && setBill(r)); }, 250);
    return () => window.clearTimeout(t);
  }, [tenant?.id, tools, user]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('billing');
    if (q === 'success') setNotice('You’re subscribed — welcome in. It can take a few seconds to activate.');
    if (q === 'cancelled') setNotice('Checkout was cancelled — nothing was charged.');
  }, []);
  // After a successful checkout, the account turns active the moment Stripe confirms.
  useEffect(() => { if (notice.startsWith('You’re subscribed') && tenant?.subscriptionStatus === 'active') { const t = window.setTimeout(() => router.push('/dashboard'), 1500); return () => window.clearTimeout(t); } }, [notice, tenant?.subscriptionStatus, router]);
  const needsCheckout = !!bill?.enabled && !bill?.subscription && isNew;
  const startCheckout = async () => {
    setBusy(true); setErr('');
    const r = await billingApi({ action: 'checkout', tools });
    if (r.ok && r.url) { window.location.href = r.url; return; }
    setErr(r.error || 'Couldn’t start checkout.'); setBusy(false);
  };
  const openPortal = async () => { const r = await billingApi({ action: 'portal' }); if (r.ok && r.url) window.location.href = r.url; else setErr(r.error || 'Couldn’t open billing.'); };

  useEffect(() => {
    if (!tenant || tools) return;
    const chosen = Array.isArray(tenant.signupTools) && tenant.subscriptionStatus !== 'active'
      ? (tenant.signupTools as string[]).filter((x) => TOOL_BY_ID[x as ToolId]) as ToolId[]
      : tenant.modules ? fromTenantModules(tenant.modules) : (RECOMMENDED[tenant.businessType || 'other'] as ToolId[]);
    setTools(chosen.length ? chosen : (RECOMMENDED.other as ToolId[]));
  }, [tenant, tools]);

  // Saved by the server: account-status fields can't be changed from the
  // browser any more (firestore.rules), so activation can't be faked.
  const save = async () => {
    if (!tenant || !tools || !user) return;
    setBusy(true); setErr('');
    try {
      const tk = await user.getIdToken();
      const r = await fetch('/api/account/activate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ tenantId: tenant.id, tools }) });
      const d = await r.json().catch(() => null);
      if (!d?.ok) throw new Error(d?.error || 'Couldn’t save your tools.');
      router.push('/dashboard');
    } catch (e: any) {
      setErr(String(e?.message || 'Couldn’t save your tools — check your connection and try again.'));
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-dvh overflow-x-hidden text-stone-900">
      <AuthBackdrop />
      <div className="relative z-10 px-5 py-6">
        <header className="mx-auto flex max-w-6xl items-center justify-between">
          <Wordmark className="text-lg" />
          {!isNew && tenant && <Link href="/dashboard" className="text-sm text-stone-600">Back to the app</Link>}
        </header>

        {isLoading || !tools ? (
          <div className="flex min-h-[60dvh] items-center justify-center"><Loader className="h-6 w-6 animate-spin text-stone-400" /></div>
        ) : (
          <main className="mx-auto max-w-6xl pb-32 pt-10">
            <p className="text-center text-xs uppercase tracking-[0.3em] text-stone-400">{isNew ? 'You’re in' : 'Your tools'}</p>
            <h1 className="mt-3 text-center text-balance text-4xl font-light tracking-tight sm:text-6xl">
              {isNew ? <>Welcome to <span className="font-semibold">{tenant?.name || 'ClarityFlow'}.</span></> : <>Your <span className="font-semibold">ClarityFlow.</span></>}
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-center text-lg text-stone-600">
              {isNew ? 'Here’s what we’ve switched on for you. Change anything — your app will show only what you use.' : 'Turn tools on or off. Your sidebar updates to match.'}
            </p>

            {notice && <p className="mx-auto mt-6 max-w-2xl rounded-2xl bg-emerald-50 p-4 text-center text-emerald-900">{notice}</p>}
            {!bill?.enabled ? (
              <div className="glass mx-auto mt-8 max-w-2xl rounded-[2rem] p-5 text-center sm:p-6">
                <p className="text-xs uppercase tracking-[0.25em] text-stone-400">Early access</p>
                <p className="mt-2 text-2xl font-light tracking-tight">Every tool included — <span className="font-semibold">on us, for now.</span></p>
                <p className="mt-2 text-stone-600">When plans launch, you’ll pay only for the tools you keep on — and you’ll hear first, with pricing before anything changes.</p>
              </div>
            ) : (
              <div className="glass mx-auto mt-8 max-w-2xl rounded-[2rem] p-5 sm:p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.25em] text-stone-400">Your plan</p>
                  <p className="text-3xl font-light tracking-tight">${bill.quote.total}<span className="text-base text-stone-500">/month</span></p>
                </div>
                {bill.foundingPct > 0 && <p className="mt-1 text-right text-sm font-medium text-emerald-700">Founding member: {bill.foundingPct}% off, forever → ${Math.round(bill.quote.total * (100 - bill.foundingPct)) / 100}/month</p>}
                <div className="mt-3 space-y-1">
                  {bill.quote.lines.map((l: any) => <p key={l.key} className="flex justify-between text-sm"><span className="text-stone-600">{l.name}{l.qty > 1 ? ` × ${l.qty}` : ''}</span><span>${l.total}</span></p>)}
                </div>
                <div className="mt-3 rounded-2xl bg-white/60 p-3">
                  <div className="flex justify-between text-sm"><span>Texts this month</span><span className="font-semibold">{(bill.textsThisMonth || 0).toLocaleString()} of {bill.quote.textsIncluded.toLocaleString()} included</span></div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-white"><div className={`h-1.5 rounded-full ${(bill.textsThisMonth || 0) > bill.quote.textsIncluded ? 'bg-amber-500' : 'bg-stone-900'}`} style={{ width: `${Math.min(100, ((bill.textsThisMonth || 0) / Math.max(1, bill.quote.textsIncluded)) * 100)}%` }} /></div>
                  <p className="mt-1 text-[11px] text-stone-500">Beyond that, 3¢ per text — added to next month’s invoice. Emails are always included.</p>
                </div>
                <p className="mt-3 text-[12px] text-stone-500">Priced for {bill.quote.size.staff} team member{bill.quote.size.staff === 1 ? '' : 's'}{bill.quote.tools.includes('renters') ? ` and ${bill.quote.size.renters} renter${bill.quote.size.renters === 1 ? '' : 's'}` : ''}. Change tools any time — the difference is prorated.{bill.freeUntil && new Date(bill.freeUntil) > new Date() ? ` Free until ${new Date(bill.freeUntil).toLocaleDateString()}.` : ''}</p>
                {bill.subscription && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/70 p-3 text-sm">
                    <span>{bill.subscription.status === 'past_due' ? <span className="font-semibold text-red-700">Payment failed — update your card</span> : bill.subscription.status === 'trialing' ? 'Free period — billing starts automatically' : 'Subscribed'}{bill.subscription.currentPeriodEnd ? ` · renews ${new Date(bill.subscription.currentPeriodEnd).toLocaleDateString()}` : ''}{bill.subscription.cancelAtPeriodEnd ? ' · ends then' : ''}</span>
                    <button type="button" onClick={openPortal} className="rounded-full bg-stone-900 px-4 py-2 text-[13px] text-white">Manage billing</button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-10">
              <ToolPicker value={tools} onChange={setTools} niche={tenant?.businessType || null} nicheLabel={null} />
            </div>
          </main>
        )}
      </div>

      {tools && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/70 bg-white/80 px-5 pt-3 backdrop-blur-xl" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <p className="hidden min-w-0 flex-1 text-sm text-stone-600 sm:block"><span className="font-semibold text-stone-900">{new Set(['booking', 'guest', ...tools]).size} tools</span> · gives back about {hoursFor(Array.from(new Set(['booking', 'guest', ...tools])) as ToolId[])} hrs a week</p>
            {err && <p className="text-[12px] text-red-700">{err}</p>}
            <button type="button" disabled={busy || !tenant} onClick={needsCheckout ? startCheckout : save} className="flex h-12 flex-1 items-center justify-center rounded-full bg-stone-900 px-6 text-sm font-medium text-white shadow-[0_12px_30px_-12px_rgba(28,25,23,0.6)] disabled:opacity-50 sm:flex-none">
              {busy ? <Loader className="h-4 w-4 animate-spin" /> : needsCheckout ? `Start subscription · $${bill.quote.total}/mo` : isNew ? 'Enter ClarityFlow' : 'Save my tools'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
