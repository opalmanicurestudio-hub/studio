'use client';
// src/app/(app)/events/[eventId]/sheet/page.tsx — THE EVENT SHEET (design canvas "Event sheet and final invoice";
// lib/event-sheet, api/event-sheet). One page the team works the event from, made from the quote and the event: when
// and where, the guests, the client, what's included, the run of show, the menu from the guests' choices with the
// allergies, the team, the seating and the notes; for managers, the money and the final invoice (not printed). Prints on
// one page.
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { clockWords, money, type SheetMoney } from '@/lib/event-sheet';
import type { Moment } from '@/lib/event-night';
import FinalInvoiceCard from '@/components/events/FinalInvoiceCard';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-[14.5px] font-semibold ${RING}`;

type Sheet = {
  business: string; title: string; when: string; date: string; where: string | null;
  guests: { guaranteed: number | null; onList: number };
  client: { name: string | null; phone: string | null; email: string | null } | null;
  included: string[]; show: Moment[]; showSaved: boolean;
  menu: { guests: number; dishes: { id: string; name: string; course: number; portions: number }[]; unchosen: number; allergies: { name: string; count: number }[]; diets: { name: string; count: number }[] } | null;
  team: { name: string; job: string }[]; seating: string | null; notes: string | null; fromQuote: boolean; money: SheetMoney | null;
};

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/event-sheet', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const COURSE: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t pt-3 print:break-inside-avoid" style={{ borderColor: LINE }}>
      <h2 className="mb-1.5 text-[13.5px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function EventSheetPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const { eventId } = (useParams() || {}) as { eventId?: string };
  const router = useRouter();
  const [s, setS] = useState<Sheet | null>(null); const [err, setErr] = useState('');
  // The money prints only when a manager asks for it: the team's copy leaves the office.
  const [withMoney, setWithMoney] = useState(false);
  const print = (money: boolean) => {
    setWithMoney(money);
    // Back to the team's copy once it's printed, so printing again from the browser leaves the money off.
    if (money) window.addEventListener('afterprint', () => setWithMoney(false), { once: true });
    setTimeout(() => window.print(), 50);
  };

  const load = useCallback(async () => {
    if (!tenantId || !eventId) return;
    const d = await post({ tenantId, eventId, action: 'view' });
    if (d.ok) { setS(d.sheet); setErr(''); } else setErr(d.error || 'The event sheet didn’t load. Try again.');
  }, [tenantId, eventId]);
  useEffect(() => { void load(); }, [load]);

  if (!tenantId || !eventId) return null;
  if (!s) return <div className="p-6 text-[15px]" style={{ color: err ? AMBER : MUTED }}>{err || 'Putting the event sheet together…'}</div>;
  const printed = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const g = s.guests; const m = s.money;
  const courses = Array.from(new Set((s.menu?.dishes || []).filter((d) => d.portions > 0).map((d) => d.course))).sort((a, b) => a - b);

  return (
    <main className="mx-auto w-full max-w-[820px] space-y-4 px-4 py-6 sm:px-6 print:max-w-none print:p-0" style={{ color: INK }}>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <button type="button" onClick={() => router.push(`/events/${eventId}/manifest`)} className={`${btn} px-0 underline underline-offset-4`}>Back to the event</button>
        <div className="flex flex-wrap gap-2">
          {s.money && <button type="button" onClick={() => print(true)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}` }}>Print with money</button>}
          <button type="button" onClick={() => print(false)} className={btn} style={{ background: INK, color: '#fff' }}>Print</button>
        </div>
      </div>
      {err && <p role="alert" className="rounded-xl px-4 py-3 text-[14px] print:hidden" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}

      <article className="space-y-3 rounded-2xl border bg-[#fff] p-5 sm:p-7 print:rounded-none print:border-0 print:p-0" style={{ borderColor: LINE }}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12.5px]" style={{ color: MUTED }}>Event sheet</p>
            <h1 className="text-[24px] font-semibold leading-tight">{s.title}</h1>
            {s.when && <p className="text-[15px]">{s.when}</p>}
          </div>
          <div className="text-[12.5px] sm:text-right" style={{ color: MUTED }}>{s.business && <p>{s.business}</p>}<p>Printed {printed}</p></div>
        </header>

        <dl className="grid gap-3 sm:grid-cols-3">
          <div><dt className="text-[12.5px]" style={{ color: MUTED }}>Where</dt><dd className="text-[14.5px]">{s.where || 'Here'}</dd></div>
          <div><dt className="text-[12.5px]" style={{ color: MUTED }}>Guests</dt><dd className="text-[14.5px] tabular-nums">{g.guaranteed ? (s.fromQuote ? `${g.guaranteed}, guaranteed` : `Planned for ${g.guaranteed}`) : `${g.onList} on the list`}{g.guaranteed && g.onList && g.onList !== g.guaranteed ? <span className="block text-[12.5px]" style={{ color: MUTED }}>{g.onList} on the list now</span> : null}</dd></div>
          {s.client && <div><dt className="text-[12.5px]" style={{ color: MUTED }}>Client</dt><dd className="text-[14.5px]">{[s.client.name, s.client.phone].filter(Boolean).join(', ')}{s.client.email && <span className="block text-[12.5px] break-all" style={{ color: MUTED }}>{s.client.email}</span>}</dd></div>}
        </dl>

        {s.included.length > 0 && <Section title={s.fromQuote ? 'What’s included, from the quote' : 'What’s included'}><ul className="grid gap-x-6 gap-y-0.5 text-[14px] sm:grid-cols-2">{s.included.map((x, i) => <li key={i}>{x}</li>)}</ul></Section>}

        {s.show.length > 0 && (
          <Section title="Run of show">
            <ol className="space-y-0.5">{s.show.map((x) => <li key={x.id} className="grid grid-cols-[76px_1fr] gap-2 text-[14px]"><span className="tabular-nums">{clockWords(x.at)}</span><span>{x.what}{x.note ? <span style={{ color: MUTED }}>. {x.note}</span> : null}</span></li>)}</ol>
            {!s.showSaved && <p className="mt-1 text-[12.5px] print:hidden" style={{ color: MUTED }}>A first plan from the start time and the courses. Change it on the event’s page.</p>}
          </Section>
        )}

        {s.menu && (courses.length > 0 || s.menu.allergies.length > 0) && (
          <Section title="Menu, from the guests’ choices">
            {courses.map((c) => (
              <div key={c} className="mb-1">
                {courses.length > 1 && <p className="text-[12.5px] font-semibold" style={{ color: MUTED }}>{COURSE[c] || `Course ${c}`}</p>}
                {s.menu!.dishes.filter((d) => d.course === c && d.portions > 0).map((d) => <p key={d.id} className="flex justify-between gap-3 text-[14px]"><span>{d.name}</span><span className="tabular-nums">{d.portions}</span></p>)}
              </div>))}
            {s.menu.unchosen > 0 && <p className="text-[12.5px]" style={{ color: AMBER }}>{s.menu.unchosen} {s.menu.unchosen === 1 ? 'choice is' : 'choices are'} still to be made.</p>}
            {(s.menu.allergies.length > 0 || s.menu.diets.length > 0) && <p className="mt-1 text-[13px]" style={{ color: MUTED }}>
              {s.menu.allergies.length > 0 && <>Allergies: {list(s.menu.allergies.map((a) => `${a.name} (${a.count})`))}. </>}
              {s.menu.diets.length > 0 && <>Diets: {list(s.menu.diets.map((a) => `${a.name} (${a.count})`))}.</>}</p>}
          </Section>
        )}

        {s.team.length > 0 && <Section title="Team"><p className="text-[14px]">{list(s.team.map((t) => `${t.name} (${t.job})`))}</p></Section>}
        {s.seating && <Section title="Seating"><p className="text-[14px]">{s.seating}</p></Section>}
        {s.notes && <Section title="Notes, for managers"><p className="whitespace-pre-line text-[14px] leading-relaxed">{s.notes}</p></Section>}

        {m && (m.quotedCents > 0 || m.paidCents > 0) && (
          <div className={withMoney ? '' : 'print:hidden'}><Section title="Money">
            <p className="flex justify-between text-[14px]"><span>Quoted</span><span className="tabular-nums">{money(m.quotedCents)}</span></p>
            {m.depositCents > 0 && <p className="flex justify-between text-[14px]"><span>Deposit{m.depositPaid ? ', paid' : ', not paid yet'}</span><span className="tabular-nums">{money(m.depositCents)}</span></p>}
            {m.paidCents > m.depositCents && <p className="flex justify-between text-[14px]"><span>Paid so far</span><span className="tabular-nums">{money(m.paidCents)}</span></p>}
            <p className="flex justify-between text-[14.5px] font-semibold"><span>Balance before extras</span><span className="tabular-nums">{money(m.balanceCents)}</span></p>
          </Section></div>
        )}
      </article>

      {m && tenantId && <FinalInvoiceCard tenantId={tenantId} eventId={eventId} guaranteed={s.fromQuote ? g.guaranteed : null} quotedCents={m.quotedCents} paidBeforeCents={m.paidCents} />}
    </main>
  );
}
