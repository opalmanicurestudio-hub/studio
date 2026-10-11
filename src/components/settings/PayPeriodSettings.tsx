'use client';
// src/components/settings/PayPeriodSettings.tsx — SETTINGS → TIME CLOCK & PAY → PAY PERIODS. How often the team is paid,
// the day periods start, and how many days after a period ends payday falls (tenant.payroll — lib/pay-periods reads it
// for the staff Pay tab, pay stubs, PDFs and payroll). Shows the current and next periods so the owner sees the result.
import * as React from 'react';
import { Section, Row, Choice, cfInput, cfInputStyle } from '@/components/settings/settings-ui';
import { periodOf, periodSettings } from '@/lib/pay-periods';

const nice = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export function PayPeriodSettings({ tenant, onChange }: { tenant: any; onChange: (patch: Record<string, any>) => void }) {
  const s = periodSettings(tenant); const pr = tenant?.payroll || {};
  const set = (patch: Record<string, any>) => onChange({ ...pr, ...patch });
  let today: string; try { today = new Date().toLocaleDateString('en-CA', { timeZone: s.tz }); } catch { today = new Date().toISOString().slice(0, 10); }
  const cur = periodOf(tenant, today); const next = periodOf(tenant, addDays(cur.to, 1));
  return (
    <Section title="Pay periods" help="Used for the team’s Pay tab, pay stubs and payroll.">
      <Row label="How often you pay" inline>
        <Choice label="How often you pay" value={s.cadence} options={[{ value: 'weekly', label: 'Weekly' }, { value: 'bi-weekly', label: 'Every 2 weeks' }, { value: 'monthly', label: 'Monthly' }]}
          onChange={(v) => set({ cadence: v })} />
      </Row>
      {s.cadence !== 'monthly' && <Row label="A pay period started on" help="Any day one of your pay periods began. The rest follow from it." inline>
        <input type="date" aria-label="A pay period started on" value={s.anchor} onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) set({ periodAnchor: e.target.value }); }} className={cfInput} style={{ ...cfInputStyle, width: 176 }} />
      </Row>}
      <Row label="Payday" help="How many days after a period ends the team is paid." inline>
        <span className="inline-flex items-center gap-2"><input type="number" inputMode="numeric" min={0} max={30} value={pr.paydayAfterDays ?? s.after}
          onChange={(e) => { if (e.target.value === '') return; const n = Math.max(0, Math.min(30, Math.round(Number(e.target.value)))); if (Number.isFinite(n)) set({ paydayAfterDays: n }); }}
          aria-label="Days after the period ends" className={cfInput} style={{ ...cfInputStyle, width: 84 }} /><span className="whitespace-nowrap text-[14px] cf-muted">days after it ends</span></span>
      </Row>
      <div className="px-5 py-4 text-[14px]" style={{ borderTop: '1px solid var(--line)' }}>
        <p><span className="cf-muted">This period</span> · {nice(cur.from)} – {nice(cur.to)} · <b>paid {nice(cur.payday)}</b></p>
        <p className="mt-1"><span className="cf-muted">Next</span> · {nice(next.from)} – {nice(next.to)} · paid {nice(next.payday)}</p>
      </div>
    </Section>);
}
