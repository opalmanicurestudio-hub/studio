'use client';
// src/components/money/GustoMatchCard.tsx — MATCH YOUR TEAM TO GUSTO, AND EACH PAYROLL'S STATUS (Money › Payday, once Gusto
// is connected; design board "Timesheets and Gusto", Gusto A). Each employee here and who they are in Gusto: matched
// (saved, or by the same email, which the server saves), a likely match by name to confirm, or one to pick. Payroll goes
// to Gusto once every employee with pay is matched. Under it, the payrolls sent and where each one is. The Payday tab
// reads Gusto (api/gusto/employees, api/gusto/payroll) and hands everything in.
import * as React from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', GREEN_TINT = '#eaf6ef', AMBER = '#b45309', AMBER_TINT = '#fff7ed', SOFT = '#f5f5f7';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const field = `h-11 rounded-xl bg-[#fff] px-3 text-[15px] ${RING}`;

export type GustoPerson = { gustoEmployeeId: string; name: string; email?: string | null; terminated?: boolean; staffId?: string; suggestedStaffId?: string; how?: 'saved' | 'email' };
export type TeamPerson = { id: string; name: string; contractor?: boolean; hasPay?: boolean };
export type GustoRun = { id: string; from: string; to: string; people: number; gross: number | null; status: string; checkDate?: string | null; sentAt?: string | null };

const usd = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (k?: string | null) => (k ? new Date(`${String(k).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '');
/** "November 2 to 15", "November 30 to December 13". */
const span = (a: string, b: string) => (a.slice(0, 7) === b.slice(0, 7) ? `${day(a)} to ${Number(b.slice(8, 10))}` : `${day(a)} to ${day(b)}`);
/** Where a payroll is, in words, and how it looks. */
export function runWords(r: GustoRun, today = new Date().toISOString().slice(0, 10)): { text: string; tone: 'good' | 'wait' | 'warn' } {
  const s = String(r.status || '').toLowerCase();
  if (s === 'processed' || s === 'paid') return { text: r.checkDate && r.checkDate <= today ? `Paid ${day(r.checkDate)}` : `Paying ${day(r.checkDate)}`, tone: 'good' };
  if (s === 'submitted' || s === 'processing') return { text: r.checkDate ? `Sent, paying ${day(r.checkDate)}` : 'Sent, being processed', tone: 'wait' };
  if (s === 'synced_not_submitted') return { text: 'In Gusto, to submit there', tone: 'warn' };
  if (s === 'failed') return { text: 'Not sent', tone: 'warn' };
  return { text: 'Sent', tone: 'wait' };
}

export function GustoMatchCard(p: {
  companyName?: string; team: TeamPerson[]; gusto: GustoPerson[] | null; loading: boolean; error?: string | null; busy?: string | null;
  onMatch: (staffId: string, gustoEmployeeId: string) => void; onLookAgain: () => void;
  runs: GustoRun[]; onCheckRun: (id: string) => void;
}) {
  const employees = p.team.filter((t) => !t.contractor);
  const contractors = p.team.filter((t) => t.contractor);
  const list = (p.gusto || []).filter((g) => !g.terminated);
  // (A match to someone who has left in Gusto isn't one: they're picked again from the current records.)
  const matchOf = (id: string) => list.find((g) => g.staffId === id);
  const suggestOf = (id: string) => list.find((g) => !g.staffId && g.suggestedStaffId === id);
  const free = list.filter((g) => !g.staffId);
  const matched = employees.filter((t) => matchOf(t.id)).length;
  const [picking, setPicking] = React.useState<string | null>(null);
  const [pick, setPick] = React.useState<Record<string, string>>({});
  const tones = { good: { background: GREEN_TINT, color: GREEN }, wait: { background: SOFT, color: MUTED }, warn: { background: AMBER_TINT, color: AMBER } };

  return (
    <>
      <section aria-label="Match your team to Gusto" className="rounded-3xl bg-[#fff] px-5 pb-3 pt-4" style={{ border: `1px solid ${LINE}`, color: INK }}>
        <h3 className="text-[17px] font-semibold">Match your team to Gusto</h3>
        <p className="text-[14px]" style={{ color: MUTED }}>
          {p.loading ? `Looking in ${p.companyName || 'Gusto'}` : p.error ? p.error
            : !employees.length ? 'Nobody on the team is an employee yet.'
            : matched === employees.length ? `Everyone is matched to ${p.companyName || 'Gusto'}.` : `${matched} of ${employees.length} employees are matched. Payroll goes to Gusto once everyone with pay is.`}
        </p>
        {!p.loading && !p.error && employees.map((t) => {
          const m = matchOf(t.id), sug = suggestOf(t.id), open = picking === t.id || (!m && !sug);
          const choices = [...(m ? [m] : []), ...free.filter((g) => g !== m)];
          return (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
              <span className="min-w-[200px] flex-1">
                <span className="block text-[15px]">{t.name}</span>
                <span className="block text-[13px]" style={{ color: m ? GREEN : sug ? AMBER : t.hasPay ? AMBER : MUTED }}>
                  {m ? `Matched${m.how === 'email' ? ' by email' : ''}: ${m.name} in Gusto` : sug ? `Looks like ${sug.name} in Gusto` : free.length ? 'Not matched yet' : 'Not in Gusto yet. Add them there, then look again.'}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {sug && picking !== t.id && <>
                  <button type="button" disabled={!!p.busy} onClick={() => setPicking(t.id)} className={btn} style={plain}>Someone else</button>
                  <button type="button" disabled={!!p.busy} onClick={() => p.onMatch(t.id, sug.gustoEmployeeId)} className={btn} style={solid}>{p.busy === t.id ? 'Saving' : 'That’s them'}</button>
                </>}
                {m && picking !== t.id && <button type="button" disabled={!!p.busy || !free.length} onClick={() => setPicking(t.id)} className={btn} style={plain}>Change</button>}
                {open && choices.length > 0 && <>
                  <label className="flex w-full flex-col gap-1 text-[14px] sm:w-auto sm:flex-row sm:items-center sm:gap-2" style={{ color: MUTED }}>Who is this in Gusto
                    <select value={pick[t.id] || ''} onChange={(e) => setPick((x) => ({ ...x, [t.id]: e.target.value }))} className={`${field} w-full sm:w-auto`} style={{ border: `1px solid ${LINE}`, color: INK }}>
                      <option value="">Pick someone</option>
                      {choices.map((g) => <option key={g.gustoEmployeeId} value={g.gustoEmployeeId}>{g.name}{g.email ? `, ${g.email}` : ''}</option>)}
                    </select></label>
                  <button type="button" disabled={!!p.busy || !pick[t.id]} onClick={() => { p.onMatch(t.id, pick[t.id]); setPicking(null); }} className={btn} style={solid}>{p.busy === t.id ? 'Saving' : 'Save'}</button>
                  {picking === t.id && <button type="button" onClick={() => setPicking(null)} className={btn} style={plain}>Cancel</button>}
                </>}
              </span>
            </div>
          );
        })}
        {!p.loading && <div className="flex flex-wrap items-center gap-2 py-2" style={{ borderTop: `1px solid ${LINE}` }}>
          <button type="button" onClick={p.onLookAgain} disabled={!!p.busy} className={btn} style={plain}>Look in Gusto again</button>
          {contractors.length > 0 && <span className="text-[13px]" style={{ color: MUTED }}>{contractors.length === 1 ? `${contractors[0].name} is a contractor, so isn’t` : `${contractors.length} contractors aren’t`} on the employee payroll.</span>}
        </div>}
      </section>

      {p.runs.length > 0 && (
        <section aria-label="Payroll in Gusto" className="rounded-3xl bg-[#fff] px-5 pb-3 pt-4" style={{ border: `1px solid ${LINE}`, color: INK }}>
          <h3 className="text-[17px] font-semibold">Payroll in Gusto</h3>
          {p.runs.map((r) => { const w = runWords(r); return (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
              <span className="min-w-[200px] flex-1">
                <span className="block text-[15px]">{r.from && r.to ? span(r.from, r.to) : 'A payroll'}</span>
                <span className="block text-[13px]" style={{ color: MUTED }}>{r.sentAt ? `Sent ${day(r.sentAt)}, ` : ''}{r.people} {r.people === 1 ? 'person' : 'people'}{r.gross != null ? `, ${usd(r.gross)}` : ''}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="rounded-full px-3 py-1.5 text-[13px]" style={tones[w.tone]}>{w.text}</span>
                {w.tone !== 'good' && <button type="button" disabled={!!p.busy} onClick={() => p.onCheckRun(r.id)} className={btn} style={plain}>{p.busy === r.id ? 'Checking' : 'Check again'}</button>}
              </span>
            </div>
          ); })}
        </section>
      )}
    </>
  );
}
