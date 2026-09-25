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
import { collection, doc, query, updateDoc, where } from 'firebase/firestore';
import { Loader } from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { AuthBackdrop, Wordmark } from '@/components/auth/AuthBackdrop';
import { ToolPicker } from '@/components/modules/ToolPicker';
import { fromTenantModules, hoursFor, toTenantModules, RECOMMENDED, TOOL_BY_ID, type ToolId } from '@/lib/module-catalog';

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

  useEffect(() => {
    if (!tenant || tools) return;
    const chosen = Array.isArray(tenant.signupTools) && tenant.subscriptionStatus !== 'active'
      ? (tenant.signupTools as string[]).filter((x) => TOOL_BY_ID[x as ToolId]) as ToolId[]
      : tenant.modules ? fromTenantModules(tenant.modules) : (RECOMMENDED[tenant.businessType || 'other'] as ToolId[]);
    setTools(chosen.length ? chosen : (RECOMMENDED.other as ToolId[]));
  }, [tenant, tools]);

  const save = async () => {
    if (!firestore || !tenant || !tools) return;
    setBusy(true); setErr('');
    try {
      await updateDoc(doc(firestore, 'tenants', tenant.id), {
        modules: toTenantModules(tools),
        ...(isNew ? { subscriptionStatus: 'active', subscriptionTier: 'early_access', activatedAt: new Date().toISOString() } : {}),
      });
      router.push('/dashboard');
    } catch (e: any) {
      setErr('Couldn’t save your tools — check your connection and try again.');
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

            <div className="glass mx-auto mt-8 max-w-2xl rounded-[2rem] p-5 text-center sm:p-6">
              <p className="text-xs uppercase tracking-[0.25em] text-stone-400">Early access</p>
              <p className="mt-2 text-2xl font-light tracking-tight">Every tool included — <span className="font-semibold">on us, for now.</span></p>
              <p className="mt-2 text-stone-600">When plans launch, you’ll pay only for the tools you keep on — and you’ll hear first, with pricing before anything changes.</p>
            </div>

            <div className="mt-10">
              <ToolPicker value={tools} onChange={setTools} niche={tenant?.businessType || null} nicheLabel={null} />
            </div>
          </main>
        )}
      </div>

      {tools && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/70 bg-white/80 px-5 pt-3 backdrop-blur-xl" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <p className="hidden min-w-0 flex-1 text-sm text-stone-600 sm:block"><span className="font-semibold text-stone-900">{tools.length} tools</span> · gives back about {hoursFor(tools)} hrs a week</p>
            {err && <p className="text-[12px] text-red-700">{err}</p>}
            <button type="button" disabled={busy || !tenant} onClick={save} className="flex h-12 flex-1 items-center justify-center rounded-full bg-stone-900 px-6 text-sm font-medium text-white shadow-[0_12px_30px_-12px_rgba(28,25,23,0.6)] disabled:opacity-50 sm:flex-none">
              {busy ? <Loader className="h-4 w-4 animate-spin" /> : isNew ? 'Enter ClarityFlow' : 'Save my tools'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
