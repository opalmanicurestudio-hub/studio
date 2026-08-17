'use client';

// ─── /retail-orders/exceptions ────────────────────────────────────────────────
// The Loss & Recovery Ledger + (Round N2) the RECOVERY QUEUE. Every exception
// shows its triple — landed cost (the accounting number), retail value and
// lost margin (the operational truth) — and the recoverable ones now carry a
// working claim lifecycle: file → approve/deny → payment, partials
// accumulating, every transition appended to an event log that never erases.
// Recovered money writes a ledger income line NEXT TO the original Spoilage
// expense; net loss = landed − recovered is computed, never stored opinion.
// Recovery actions are the owner's/manager's call (the database rule is the
// enforcement; the UI mirror keeps the refusal friendly).

import { collection, onSnapshot, type Firestore } from 'firebase/firestore';
import { ArrowLeft, Clock, Copy, Loader, Printer, ShieldQuestion, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  advanceRecovery, deadlineState, markMonthHandedOff, reasonGroup, reasonLabel, recoveryNetLossCents,
  type RecoveryAction,
} from '@/lib/inventory-exceptions';

const fmt = (c: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;

const GROUP_CLS: Record<string, string> = {
  customer: 'border-slate-200 bg-slate-50 text-slate-700',
  carrier: 'border-blue-200 bg-blue-50 text-blue-700',
  supplier: 'border-purple-200 bg-purple-50 text-purple-700',
  internal: 'border-amber-200 bg-amber-50 text-amber-700',
};

const REC_CLS: Record<string, string> = {
  candidate: 'border-blue-200 bg-blue-50 text-blue-700',
  filed: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  approved: 'border-teal-200 bg-teal-50 text-teal-700',
  paid: 'border-green-200 bg-green-50 text-green-700',
  denied: 'border-red-200 bg-red-50 text-red-700',
  abandoned: 'border-slate-200 bg-slate-50 text-slate-500',
};

export default function InventoryExceptionsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { toast } = useToast();

  const staffRole = String((selectedTenant as any)?.staffMember?.role || 'owner').toLowerCase();
  const isMgr = ['owner', 'admin'].includes(staffRole);

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [fileFor, setFileFor] = useState<string | null>(null);
  const [fileAmount, setFileAmount] = useState('');
  const [fileRef, setFileRef] = useState('');
  const [fileDeadline, setFileDeadline] = useState('');
  const [fileNote, setFileNote] = useState('');
  const [payDraft, setPayDraft] = useState<Record<string, string>>({});
  const monthKey = new Date().toISOString().slice(0, 7);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    return onSnapshot(collection(firestore as Firestore, `tenants/${tenantId}/inventoryExceptions`), (snap) => {
      setRows(snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))));
      setLoading(false);
    });
  }, [firestore, tenantId]);

  const totals = useMemo(() => {
    const month = rows.filter((r) => String(r.at || '').startsWith(monthKey));
    return {
      count: month.length,
      landed: month.reduce((a, r) => a + (r.landedCostCents || 0), 0),
      retail: month.reduce((a, r) => a + (r.retailCents || 0), 0),
      margin: month.reduce((a, r) => a + (r.marginCents || 0), 0),
      recovered: month.reduce((a, r) => a + (Number(r.recovery?.recoveredCents) || 0), 0),
      net: month.reduce((a, r) => a + recoveryNetLossCents(r), 0),
      uncosted: month.filter((r) => r.costed === false).length,
    };
  }, [rows, monthKey]);

  const deadlineAlerts = useMemo(
    () => rows
      .map((r) => ({ r, st: deadlineState(r) }))
      .filter(({ st }) => st === 'soon' || st === 'overdue'),
    [rows]
  );

  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const act = async (excId: string, action: RecoveryAction, payload: any = {}) => {
    if (!firestore || !tenantId || busy) return;
    if (!isMgr) {
      toast({ variant: 'destructive', title: 'Recovery decisions are the owner\u2019s call', description: 'Filing, denying, and recording payments need a manager.' });
      return;
    }
    setBusy(`${excId}-${action}`);
    try {
      const res = await advanceRecovery(firestore as Firestore, tenantId, excId, action, payload, { id: 'staff', name: 'Manager' });
      if (!res.ok) {
        toast({ variant: 'destructive', title: 'Not updated', description: res.message });
      } else {
        toast({ title: res.message });
        if (action === 'file') { setFileFor(null); setFileAmount(''); setFileRef(''); setFileDeadline(''); setFileNote(''); }
        if (action === 'payment') setPayDraft((cur) => ({ ...cur, [excId]: '' }));
      }
    } finally {
      setBusy(null);
    }
  };

  const ACT_BTN = 'h-9 rounded-xl border-2 px-3 font-black uppercase text-[9px] tracking-widest';

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Loss &amp; recovery</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              Nothing disappears as an adjustment · recoveries offset, never erase
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
            <a href={`/print/loss-recovery/${tenantId}?month=${monthKey}`} target="_blank" rel="noreferrer">
              <Printer className="mr-1.5 h-3.5 w-3.5" /> Register
            </a>
          </Button>
          {isMgr && (
            <Button variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest"
              disabled={busy === 'handoff'}
              onClick={async () => {
                if (!firestore || !tenantId) return;
                if (!window.confirm('Stamp every exception this month as handed to accounting?')) return;
                setBusy('handoff');
                const res = await markMonthHandedOff(firestore as Firestore, tenantId, monthKey, 'Manager');
                setBusy(null);
                toast(res.ok ? { title: res.message } : { variant: 'destructive', title: 'Not stamped', description: res.message });
              }}>
              {busy === 'handoff' ? <Loader className="h-3.5 w-3.5 animate-spin" /> : 'Hand off month'}
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {([
            ['This month', String(totals.count)],
            ['Landed cost lost', fmt(totals.landed)],
            ['Retail affected', fmt(totals.retail)],
            ['Margin affected', fmt(totals.margin)],
            ['Recovered', fmt(totals.recovered)],
            ['Net loss', fmt(totals.net)],
          ] as const).map(([k, v]) => (
            <Card key={k} className={cn('border-2 rounded-2xl bg-white', k === 'Net loss' && 'border-foreground/50')}>
              <CardContent className="p-3">
                <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">{k}</p>
                <p className={cn('mt-0.5 font-mono text-lg font-black leading-none', k === 'Recovered' && totals.recovered > 0 && 'text-green-700')}>{v}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {deadlineAlerts.length > 0 && (
          <div className="space-y-1.5">
            {deadlineAlerts.map(({ r, st }) => (
              <p key={r.id} className={cn('flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest',
                st === 'overdue' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>
                <Clock className="h-3.5 w-3.5 shrink-0" />
                {st === 'overdue' ? 'Claim deadline passed' : 'Claim deadline within 7 days'} — {r.name}
                {r.recovery?.refNumber ? ` · ref ${r.recovery.refNumber}` : ''} · due {when(r.recovery?.deadlineAt)}
              </p>
            ))}
          </div>
        )}
        {totals.uncosted > 0 && (
          <p className="rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-700">
            {totals.uncosted} missing a product cost — set costPerUnit in inventory for true figures
          </p>
        )}

        {loading && <p className="py-20 text-center text-[10px] font-black uppercase tracking-widest opacity-30">Loading…</p>}
        {!loading && rows.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed py-20 text-center space-y-2">
            <ShieldQuestion className="mx-auto h-8 w-8 opacity-20" />
            <p className="text-[10px] font-black uppercase tracking-widest opacity-30">
              No exceptions yet — they appear when returns are written off or claims approved
            </p>
          </div>
        )}

        {rows.map((r) => {
          const rec = r.recovery || { status: 'none' };
          const net = recoveryNetLossCents(r);
          const dl = deadlineState(r);
          const partial = rec.status === 'paid' && (Number(rec.recoveredCents) || 0) < (Number(rec.claimAmountCents) || 0);
          return (
            <Card key={r.id} className={cn('border-2 rounded-[2rem] overflow-hidden bg-white', dl === 'overdue' && 'border-red-300')}>
              <CardContent className="p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black uppercase tracking-tight text-sm truncate">
                      {r.qty > 1 ? `${r.qty} × ` : ''}{r.name}
                    </p>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">
                      {when(r.at)}{r.orderNumber != null ? ` · order #${String(r.orderNumber).padStart(4, '0')}` : ''} · {r.responsibleParty} · via {String(r.source || '').replace('_', ' ')}
                    </p>
                  </div>
                  <span className={cn('shrink-0 rounded-full border px-2.5 py-1 text-[8px] font-black uppercase tracking-widest',
                    GROUP_CLS[r.reasonGroup] || GROUP_CLS.internal)}>
                    {reasonLabel(r.reason)}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 rounded-2xl border-2 border-dashed p-2.5 text-center">
                  <div>
                    <p className="font-mono text-sm font-black">{r.costed === false ? '—' : fmt(r.landedCostCents)}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Landed{r.ledgerTxnId ? ' · ledgered' : ''}</p>
                  </div>
                  <div>
                    <p className="font-mono text-sm font-black">{fmt(r.retailCents)}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Retail</p>
                  </div>
                  <div>
                    <p className={cn('font-mono text-sm font-black', (Number(rec.recoveredCents) || 0) > 0 && 'text-green-700')}>{fmt(rec.recoveredCents || 0)}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Recovered</p>
                  </div>
                  <div>
                    <p className="font-mono text-sm font-black">{r.costed === false ? '—' : fmt(net)}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Net loss</p>
                  </div>
                </div>

                {rec.status && rec.status !== 'none' && (
                  <div className="space-y-2 rounded-2xl border-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('rounded-full border-2 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest', REC_CLS[rec.status] || REC_CLS.candidate)}>
                        Recovery: {partial ? 'partially paid' : rec.status}
                      </span>
                      {rec.claimAmountCents > 0 && (
                        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                          asked {fmt(rec.claimAmountCents)}{rec.refNumber ? ` · ref ${rec.refNumber}` : ''}{rec.deadlineAt ? ` · due ${when(rec.deadlineAt)}` : ''}
                        </span>
                      )}
                    </div>

                    {Array.isArray(rec.events) && rec.events.length > 0 && (
                      <div className="space-y-0.5">
                        {rec.events.slice(-4).map((e: any, i: number) => (
                          <p key={i} className="text-[9px] font-bold text-muted-foreground">
                            {when(e.at)} — {e.by} · {e.action}{e.amountCents ? ` ${fmt(e.amountCents)}` : ''}{e.refNumber ? ` · ref ${e.refNumber}` : ''}{e.note ? ` · ${e.note}` : ''}
                          </p>
                        ))}
                      </div>
                    )}

                    {rec.status === 'candidate' && fileFor !== r.id && (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" className={ACT_BTN}
                          onClick={() => { setFileFor(r.id); setFileAmount(((r.landedCostCents || 0) / 100).toFixed(2)); }}>
                          File claim
                        </Button>
                        <Button variant="outline" className={cn(ACT_BTN, 'text-muted-foreground')} disabled={busy === `${r.id}-abandon`}
                          onClick={() => void act(r.id, 'abandon')}>
                          Not worth pursuing
                        </Button>
                      </div>
                    )}

                    {fileFor === r.id && (
                      <div className="space-y-2 rounded-xl border-2 border-dashed p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black">$</span>
                          <input inputMode="decimal" aria-label="Claim amount in dollars" value={fileAmount}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFileAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                            className="h-9 w-24 rounded-xl border-2 bg-white px-2 text-center font-mono text-sm font-bold outline-none focus:border-foreground/60" />
                          <input placeholder="Claim / ref #" aria-label="Claim reference number" value={fileRef}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFileRef(e.target.value)}
                            className="h-9 flex-1 min-w-28 rounded-xl border-2 bg-white px-2.5 text-sm font-bold outline-none focus:border-foreground/60" />
                          <input type="date" aria-label="Claim deadline" value={fileDeadline}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFileDeadline(e.target.value)}
                            className="h-9 rounded-xl border-2 bg-white px-2 text-sm font-bold outline-none focus:border-foreground/60" />
                        </div>
                        <input placeholder="Note (optional)" aria-label="Filing note" value={fileNote}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFileNote(e.target.value)}
                          className="h-9 w-full rounded-xl border-2 bg-white px-2.5 text-sm font-bold outline-none focus:border-foreground/60" />
                        <div className="flex gap-2">
                          <Button className={ACT_BTN} disabled={busy === `${r.id}-file`}
                            onClick={() => void act(r.id, 'file', {
                              amountCents: Math.round((Number(fileAmount) || 0) * 100),
                              refNumber: fileRef.trim() || undefined,
                              deadlineAt: fileDeadline ? new Date(`${fileDeadline}T23:59:00`).toISOString() : null,
                              note: fileNote.trim() || undefined,
                            })}>
                            {busy === `${r.id}-file` ? <Loader className="h-3.5 w-3.5 animate-spin" /> : 'File it'}
                          </Button>
                          <Button variant="outline" className={ACT_BTN} onClick={() => setFileFor(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}

                    {['filed', 'approved', 'paid'].includes(rec.status) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {rec.status === 'filed' && (
                          <>
                            <Button variant="outline" className={ACT_BTN} disabled={busy === `${r.id}-approve`}
                              onClick={() => void act(r.id, 'approve')}>Approved</Button>
                            <Button variant="outline" className={cn(ACT_BTN, 'text-red-700')} disabled={busy === `${r.id}-deny`}
                              onClick={() => void act(r.id, 'deny')}>Denied</Button>
                            <Button variant="outline" className={cn(ACT_BTN, 'text-muted-foreground')} disabled={busy === `${r.id}-abandon`}
                              onClick={() => void act(r.id, 'abandon')}>Abandon</Button>
                          </>
                        )}
                        {rec.status === 'approved' && (
                          <Button variant="outline" className={cn(ACT_BTN, 'text-red-700')} disabled={busy === `${r.id}-deny`}
                            onClick={() => void act(r.id, 'deny')}>Reversed / denied</Button>
                        )}
                        <span className="flex items-center gap-1.5">
                          <span className="text-sm font-black">$</span>
                          <input inputMode="decimal" aria-label="Payment received in dollars" placeholder="0.00"
                            value={payDraft[r.id] || ''}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayDraft({ ...payDraft, [r.id]: e.target.value.replace(/[^0-9.]/g, '') })}
                            className="h-9 w-24 rounded-xl border-2 bg-white px-2 text-center font-mono text-sm font-bold outline-none focus:border-foreground/60" />
                          <Button className={ACT_BTN} disabled={busy === `${r.id}-payment` || !(Number(payDraft[r.id]) > 0)}
                            onClick={() => void act(r.id, 'payment', { amountCents: Math.round((Number(payDraft[r.id]) || 0) * 100) })}>
                            {busy === `${r.id}-payment` ? <Loader className="h-3.5 w-3.5 animate-spin" /> : 'Record payment'}
                          </Button>
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {Array.isArray(r.flags) && r.flags.includes('possible_duplicate') && (
                    <span className="flex items-center gap-1 rounded-full border-2 border-orange-300 bg-orange-50 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-orange-700">
                      <Copy className="h-3 w-3" /> Possible duplicate — review both
                    </span>
                  )}
                  <span className={cn('rounded-full border-2 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest',
                    r.accountingStatus === 'handed_off' ? 'border-green-200 bg-green-50 text-green-700'
                      : r.accountingStatus === 'ledgered' ? 'border-slate-200 bg-slate-50 text-slate-600'
                      : 'border-slate-200 bg-white text-slate-500')}>
                    {r.accountingStatus === 'handed_off' ? 'Handed to accounting' : r.accountingStatus === 'ledgered' ? 'On the books' : 'Recorded'}
                  </span>
                  {r.costed === false && (
                    <span className="rounded-full border-2 border-amber-200 bg-amber-50 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-amber-700">
                      Needs product cost
                    </span>
                  )}
                  {r.orderId && (
                    <Link href={`/retail-orders/evidence/${r.orderId}`}
                      className="ml-auto text-[9px] font-black uppercase tracking-widest text-primary underline-offset-4 hover:underline">
                      Evidence
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </main>
    </div>
  );
}
