'use client';
// src/components/settings/PriorPayRow.tsx — PAY FROM BEFORE CLARITYFLOW (Settings › Payroll): the row, what's in, and
// the form (PriorPayDialog), saved by the server (api/payroll/prior, lib/payroll-prior).
import * as React from 'react';
import { doc } from 'firebase/firestore';
import { useFirebase, useMemoFirebase } from '@/firebase';
import { useDoc } from '@/firebase/firestore/use-doc';
import { useInventory } from '@/context/InventoryContext';
import { Row } from '@/components/settings/settings-ui';
import { PriorPayDialog, type PriorPerson } from '@/components/settings/PriorPayDialog';
import type { PriorPay } from '@/lib/payroll-prior';

const INK = '#16171a', LINE = '#ececee';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Settings › Payroll: the row, what's in, and the form. */
export function PriorPayRow({ tenantId, state, today }: { tenantId: string; state: string | null; today: string }) {
  const { firestore } = useFirebase() as any; const { staff } = useInventory();
  const year = Number(today.slice(0, 4));
  const { data: cur } = useDoc<any>(useMemoFirebase(() => (firestore && tenantId ? doc(firestore, `tenants/${tenantId}/payrollRuns/prior_${year}`) : null), [firestore, tenantId, year]));
  const { data: prev } = useDoc<any>(useMemoFirebase(() => (firestore && tenantId ? doc(firestore, `tenants/${tenantId}/payrollRuns/prior_${year - 1}`) : null), [firestore, tenantId, year]));
  // (In January, last year's is still being finished: its W-2s and Form 940.)
  const saved: PriorPay | null = cur?.kind === 'prior' ? cur : today.slice(5, 7) === '01' && prev?.kind === 'prior' ? prev : null;
  const [open, setOpen] = React.useState(false);
  const people: PriorPerson[] = React.useMemo(() => (staff || []).filter((m: any) => m.isRenter !== true && m.employmentType !== 'contractor')
    .map((m: any) => ({ id: String(m.id), name: String(m.name || 'Team member'), left: m.archived === true }))
    .sort((a: PriorPerson, b: PriorPerson) => Number(!!a.left) - Number(!!b.left) || a.name.localeCompare(b.name)), [staff]);
  const call = async (method: 'POST' | 'DELETE', b: any) => { const r: any = await fetch('/api/payroll/prior', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...b }) }).then((x) => x.json()).catch(() => null); return r?.ok ? null : (r?.error || 'Not saved. Try again.'); };
  const wages = saved ? saved.people.reduce((n, x) => n + (Number(x.wages) || 0), 0) : 0;
  return (<>
    <Row label="Pay from before ClarityFlow" help={saved ? `Through ${longDay(saved.lastPayDate)}: ${saved.people.length} ${saved.people.length === 1 ? 'person' : 'people'}, ${usd(wages)} in wages and tips. It counts toward each person’s limits for the year, and on that quarter’s and the year’s forms.` : 'For a business that ran payroll another way earlier this year: what each person was paid and had withheld, so the year’s limits and forms are whole.'} inline>
      <button type="button" onClick={() => setOpen(true)} className={btn} style={plain}>{saved ? 'Change it' : 'Put it in'}</button>
    </Row>
    <PriorPayDialog open={open} onOpenChange={setOpen} people={people} saved={saved} state={state} today={today}
      onSave={(b) => call('POST', b)} onRemove={saved ? () => call('DELETE', { year: saved.year }) : undefined} />
  </>);
}
