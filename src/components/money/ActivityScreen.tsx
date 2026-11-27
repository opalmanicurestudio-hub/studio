'use client';
// src/components/money/ActivityScreen.tsx — ACTIVITY (the Money page's Activity tab; design board "Activity: by day, in
// plain words"). What was done, newest first, grouped by day: who did it (a person, or "Done for you" when the app did it
// on its own), what it was in plain words (lib/report-builders' actionWords, the same as the audit trail report), the
// detail and the amount. The Activity tab (money/page.tsx) keeps the latest actions live and hands them in.
import * as React from 'react';
import { actionWords, knownAction } from '@/lib/report-builders';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const plainBtn = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The kinds of action to filter by, from the first part of the action's name. */
export const KINDS: [string, string, string[]][] = [
  ['all', 'Everything', []],
  ['sales', 'Sales and refunds', ['transaction', 'checkout', 'retail', 'deposit', 'balance', 'fee', 'tab', 'counter', 'rent', 'card']],
  ['bank', 'Bank', ['bank', 'rule']],
  ['pay', 'Bills and payday', ['bill', 'payroll', 'gusto']],
  ['books', 'Books and taxes', ['books', 'salestax', 'records', 'mileage', 'debt', 'night']],
];
const kindOf = (action: unknown): string => {
  const head = String(action || '').split('.')[0];
  return KINDS.find(([, , heads]) => heads.includes(head))?.[0] || 'other';
};

export type ActivityEntry = { id?: string; at?: string; action?: string; summary?: string; amount?: number; actor?: { type?: string; name?: string; via?: string } };

/** "Today", "Yesterday", "Monday, November 23" (with the year when it isn't this one). */
export function dayWords(d: Date, now = new Date()): string {
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, now)) return 'Today';
  if (same(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export function ActivityScreen({ entries, people, capped, onReports, notYours = false, now = new Date() }: {
  entries: ActivityEntry[]; people: string[];
  /** Someone who isn't the owner or a manager: the activity isn't theirs to read. */
  notYours?: boolean;
  /** The latest ones only (there are more). */
  capped: boolean;
  onReports: () => void;
  now?: Date;
}) {
  const [kind, setKind] = React.useState('all');
  const [who, setWho] = React.useState('all');   // all | app | a person's name
  const shown = entries.filter((e) => {
    const app = e.actor?.type === 'system';
    if (who === 'app' && !app) return false;
    if (who !== 'all' && who !== 'app' && (app || String(e.actor?.name || '') !== who)) return false;
    if (kind === 'other') return kindOf(e.action) === 'other';
    return kind === 'all' || kindOf(e.action) === kind;
  });
  const days: { label: string; items: ActivityEntry[] }[] = [];
  for (const e of shown) {
    const d = e.at ? new Date(e.at) : null; const label = d && !Number.isNaN(d.getTime()) ? dayWords(d, now) : 'No date';
    const last = days[days.length - 1]; if (last && last.label === label) last.items.push(e); else days.push({ label, items: [e] });
  }
  const hasOther = entries.some((e) => kindOf(e.action) === 'other');

  return (
    <div style={{ color: INK }}>
      <h2 className="text-[24px] font-semibold leading-tight">Activity</h2>
      <p className="mb-4 text-[14px]" style={{ color: MUTED }}>What was done, by whom, as it happens. Things the app did on its own say Done for you.</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:w-auto md:flex-wrap md:overflow-visible md:px-0 md:pb-0" role="group" aria-label="What to show">
          {[...KINDS.map(([k, l]) => [k, l] as [string, string]), ...(hasOther ? [['other', 'Everything else'] as [string, string]] : [])].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-full px-4 text-[14px] ${RING}`}
              style={kind === k ? { background: INK, color: '#fff', fontWeight: 600 } : plainBtn}>{l}</button>))}
        </div>
        <label className="inline-flex items-center gap-2 text-[14px]" style={{ color: MUTED }}>Who
          <select value={who} onChange={(e) => setWho(e.target.value)} className={`h-11 max-w-[220px] rounded-xl bg-[#fff] px-3 text-[14px] ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }}>
            <option value="all">Everyone</option><option value="app">Done for you</option>
            {people.map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
      </div>

      {notYours ? (
        <section aria-label="For the owner and managers" className="rounded-3xl bg-[#fff] px-5 py-4" style={{ border: `1px solid ${LINE}` }}>
          <h3 className="text-[17px] font-semibold">For the owner and managers</h3>
          <p className="text-[14px]" style={{ color: MUTED }}>What everyone does with money shows here for the owner and managers. Ask one of them if you need to see it.</p>
        </section>
      ) : days.length === 0 ? (
        <section aria-label="Nothing yet" className="rounded-3xl bg-[#fff] px-5 py-4" style={{ border: `1px solid ${LINE}` }}>
          <h3 className="text-[17px] font-semibold">{entries.length ? 'Nothing matches' : 'Nothing yet'}</h3>
          <p className="text-[14px]" style={{ color: MUTED }}>{entries.length ? 'Nothing here for what’s picked. Try Everything or Everyone.' : 'What you, your team and the app do shows here the moment it happens.'}</p>
        </section>
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <section key={d.label} aria-label={d.label} className="rounded-3xl bg-[#fff] px-5 pb-2 pt-4" style={{ border: `1px solid ${LINE}` }}>
              <h3 className="text-[17px] font-semibold">{d.label}</h3>
              <div className="mt-2">
                {d.items.map((e, i) => {
                  const app = e.actor?.type === 'system'; const t = e.at ? new Date(e.at) : null;
                  // (An action without its own words reads better by what it says it did.)
                  const said = e.summary ? String(e.summary).replace(/ \u00b7 /g, ', ') : '';
                  const title = knownAction(e.action) || !said ? actionWords(e.action) : said; const detail = title === said ? '' : said;
                  return (
                    <div key={e.id || `${d.label}-${i}`} className="flex gap-3 py-2.5" style={{ borderTop: `1px solid ${LINE}` }}>
                      <span className="w-[60px] shrink-0 pt-0.5 text-[13px] tabular-nums" style={{ color: MUTED }}>{t && !Number.isNaN(t.getTime()) ? t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words font-semibold">{title}</span>
                        {detail && <span className="block break-words text-[14px]" style={{ color: MUTED }}>{detail}</span>}
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {app
                            ? <span className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ background: SOFT, color: MUTED }}>Done for you</span>
                            : <span className="text-[13px]" style={{ color: MUTED }}>{e.actor?.name || 'Someone on the team'}</span>}
                          {e.actor?.via === 'manager-pin' && <span className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>With a manager’s PIN</span>}
                        </span>
                      </span>
                      {typeof e.amount === 'number' && Number.isFinite(e.amount) && <span className="shrink-0 pt-0.5 tabular-nums">{usd(e.amount)}</span>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {capped && (
            <div className="flex flex-wrap items-center gap-3 px-1">
              <p className="text-[14px]" style={{ color: MUTED }}>These are the latest {entries.length}. The audit trail in Reports has every one, for any dates.</p>
              <button type="button" onClick={onReports} className={btn} style={plainBtn}>Open Reports</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
