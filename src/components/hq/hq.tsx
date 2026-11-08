'use client';
// src/components/hq/hq.tsx — the ClarityFlow HQ design kit.
//
// Same world as the landing page and sign-in: warm paper, soft moving light,
// glass cards, light type with a bold accent. Tabs follow the member's role.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getAuth, sendEmailVerification } from 'firebase/auth';
import { AuthBackdrop, Wordmark } from '@/components/auth/AuthBackdrop';

export async function hq(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/hq', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}

export const HEALTH_TONE: Record<string, string> = {
  thriving: 'bg-emerald-600 text-white', healthy: 'bg-emerald-100 text-emerald-800', watch: 'bg-amber-100 text-amber-800', 'at risk': 'bg-red-100 text-red-700', new: 'bg-sky-100 text-sky-800',
};
export const PRIORITY_TONE: Record<string, string> = { urgent: 'bg-red-600 text-white', high: 'bg-amber-100 text-amber-800', normal: 'bg-muted text-foreground/80', low: 'bg-sky-50 text-sky-700' };
export const ago = (iso?: string | null) => {
  if (!iso) return '—';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return m <= 1 ? 'just now' : `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return d === 1 ? 'yesterday' : `${d} days ago`;
};
export const money = (n?: number | null, dp = 0) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
export const pctText = (n?: number | null) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n}%`);
export const rate = (n?: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);

/** Who's signed in to HQ, and what they may do. */
export function useHqMe() {
  const [me, setMe] = useState<any>(null);
  useEffect(() => {
    const unsub = getAuth().onAuthStateChanged(async (u) => {
      if (!u) return;
      const d = await hq({ action: 'whoami' });
      // The "not verified yet" note belongs to one check only; anyone who's through (or not on the list) starts clean.
      if (!d?.verifyEmail) { try { sessionStorage.removeItem('cf_hq_checked'); } catch { /* private window */ } }
      setMe(d);
    });
    return () => unsub();
  }, []);
  return me;
}

/** HQ trusts an email only once it's verified (lib/platform-admin): one email to send, then back here. */
function VerifyEmailCard({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'checking' | 'error' | 'notYet' | 'tooMany'>(() => { try { if (sessionStorage.getItem('cf_hq_checked') === '1') { sessionStorage.removeItem('cf_hq_checked'); return 'notYet'; } } catch { /* private window */ } return 'idle'; });
  const send = async () => {
    const u = getAuth().currentUser; if (!u) return;
    setState('sending');
    try { await sendEmailVerification(u); setState('sent'); } catch (e: any) { setState(String(e?.code || '').includes('too-many-requests') ? 'tooMany' : 'error'); }
  };
  const done = async () => {
    const u = getAuth().currentUser; if (!u) return;
    setState('checking');
    try { await u.reload(); await u.getIdToken(true); try { sessionStorage.setItem('cf_hq_checked', '1'); } catch { /* private window */ } window.location.reload(); } catch { setState('error'); }
  };
  return (
    <div className="glass mx-auto max-w-lg space-y-3 rounded-[2rem] p-6">
      <h2 className="text-xl font-semibold">Verify your email to open HQ</h2>
      <p className="text-foreground/80">HQ opens only for a verified email. We’ll send a link to <span className="font-semibold">{email}</span>. Open it, then come back and press Done.</p>
      {state === 'error' && <p role="alert" className="text-[14px]" style={{ color: 'var(--warn-ink, #8a4b0b)' }}>That didn’t work. Please try again in a minute.</p>}
      {state === 'sent' && <p className="text-[14px] text-foreground/80">Sent. Check your inbox (and spam).</p>}
      {state === 'tooMany' && <p role="alert" className="text-[14px]" style={{ color: 'var(--warn-ink, #8a4b0b)' }}>A few links went out already. Wait a few minutes, check your inbox and spam, then try again.</p>}
      {state === 'notYet' && <p role="status" className="text-[14px]" style={{ color: 'var(--warn-ink, #8a4b0b)' }}>Your email isn’t verified yet. Open the link in the email first, then press Done.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={send} disabled={state === 'sending'} className="inline-flex h-11 items-center rounded-full bg-foreground px-5 text-[14px] font-semibold text-background disabled:opacity-60">{state === 'sending' ? 'Sending…' : state === 'sent' ? 'Send again' : 'Send the link'}</button>
        <button type="button" onClick={done} disabled={state === 'checking'} className="inline-flex h-11 items-center rounded-full border border-foreground/20 px-5 text-[14px] font-semibold disabled:opacity-60">{state === 'checking' ? 'Checking…' : 'Done'}</button>
      </div>
    </div>
  );
}

const TABS: [string, string, string][] = [
  ['/admin/tenants', 'Businesses', 'tenants'], ['/admin/support', 'Help desk', 'tickets'], ['/admin/insights', 'Insights', 'insights'],
  ['/admin/finance', 'Finance', 'finance'], ['/admin/early-access', 'Early access', 'invites'], ['/admin/system', 'System', 'system'], ['/admin/team', 'Team', 'team'],
];

export function HqShell({ children, title, sub, action }: { children: React.ReactNode; title?: string; sub?: string; action?: React.ReactNode }) {
  const path = usePathname() || '';
  const me = useHqMe();
  const tabs = TABS.filter(([, , perm]) => !me?.perms || me.perms.includes(perm));
  return (
    <div className="relative min-h-dvh text-foreground">
      <AuthBackdrop />
      <div className="relative z-10">
        <div className="sticky top-0 z-30 border-b border-white/60 bg-card/55 backdrop-blur-2xl">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <Link href="/admin/tenants" className="shrink-0 text-base"><Wordmark /> <span className="ml-1 rounded-md bg-foreground px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-[0.2em] text-background">HQ</span></Link>
            <nav className="-mx-1 flex gap-1 overflow-x-auto px-1">
              {tabs.map(([h, l]) => <Link key={h} href={h} className={`h-9 shrink-0 rounded-full px-3.5 text-sm leading-9 transition-colors ${path.startsWith(h) ? 'bg-foreground text-background' : 'text-foreground/80 hover:bg-card/70'}`}>{l}</Link>)}
            </nav>
            <span className="ml-auto flex shrink-0 items-center gap-3">
              {me?.role && <span className="hidden text-[12px] text-muted-foreground md:block">{me.name} · {me.role}</span>}
              <Link href="/dashboard" className="rounded-full px-3 py-1.5 text-[12px] text-foreground/80 hover:bg-card/70">← My studio</Link>
            </span>
          </div>
        </div>
        <main className="mx-auto max-w-6xl px-4 pb-28 pt-6">
          {title && (
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div><h1 className="text-3xl font-light tracking-tight sm:text-4xl">{title}</h1>{sub && <p className="mt-1 text-foreground/80">{sub}</p>}</div>
              {action}
            </div>
          )}
          {me?.verifyEmail ? <VerifyEmailCard email={me.email} /> : children}
        </main>
      </div>
    </div>
  );
}

export const Glass = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <section className={`glass rounded-[1.75rem] border border-white/70 p-5 shadow-[0_10px_40px_-24px_rgba(28,25,23,0.35)] ${className}`}>{children}</section>
);
export const Label = ({ children }: { children: React.ReactNode }) => <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground">{children}</p>;
export const Stat = ({ label, value, sub, tone = '' }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) => (
  <div className="glass rounded-3xl border border-white/70 p-4"><Label>{label}</Label><p className={`mt-1 text-2xl font-semibold tracking-tight ${tone}`}>{value}</p>{sub && <p className="text-[12px] text-muted-foreground">{sub}</p>}</div>
);
export const Chip = ({ on, onClick, children }: { on?: boolean; onClick?: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} aria-pressed={on} className={`h-9 shrink-0 rounded-full px-3.5 text-[13px] transition-colors ${on ? 'bg-foreground text-background' : 'glass border border-white/70 text-foreground/80 hover:text-foreground'}`}>{children}</button>
);
export const Loading = () => <div className="flex justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-stone-900" /></div>;

/** A tiny trend line — no chart library. */
export function Spark({ values, className = '' }: { values: number[]; className?: string }) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return <span className="text-[11px] text-muted-foreground">trend builds daily</span>;
  const min = Math.min(...v), max = Math.max(...v), w = 120, h = 32;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * w},${h - ((x - min) / (max - min || 1)) * h}`).join(' ');
  return <svg viewBox={`0 0 ${w} ${h}`} className={`h-8 w-28 ${className}`} aria-hidden><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

// Kept for older pages.
export function HqNav() { return null; }
