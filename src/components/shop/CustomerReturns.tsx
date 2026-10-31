'use client';
// src/components/shop/CustomerReturns.tsx — THE CUSTOMER'S RETURNS ON THEIR ORDER PAGE (mockup 10C). Each return and
// where it is, in three steps (lib/return-view), with the prepaid label while it's still to come back. In the order
// page's own card style.
import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { customerReturnStatus } from '@/lib/return-view';

/** labelFailedId: a return started on this page whose label couldn't be asked for (the request itself failed). */
export function CustomerReturns({ returns, method, timeZone, labelFailedId = '' }: { returns: any[]; method: string; timeZone?: string | null; labelFailedId?: string }) {
  const day = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: timeZone || undefined }) : ''; };
  return (
    <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
      <CardContent className="p-5 space-y-3">
        <h2 className="m-0 text-[11px] font-black uppercase tracking-widest">Your {returns.length === 1 ? 'return' : 'returns'}</h2>
        {returns.map((r: any) => {
          // Where it is, in the shop's words (lib/return-view).
          const v = customerReturnStatus(r.id === labelFailedId && !r.hasLabel ? { ...r, labelFailed: true } : r, method, day);
          return (
            <div key={r.id} className={cn('rounded-2xl border-2 p-3 space-y-2', v.tone === 'ok' ? 'border-primary/30 bg-primary/[0.03]' : v.tone === 'no' ? 'border-slate-200' : 'border-amber-200 bg-amber-50/40')}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="m-0 text-xs font-black uppercase tracking-tight">{v.title}</h3>
                <p aria-live="polite" className={cn('m-0 shrink-0 text-[11px] font-black uppercase tracking-widest', v.tone === 'ok' ? 'text-primary' : v.tone === 'no' ? 'text-muted-foreground' : 'text-amber-800')}>{v.label}</p>
              </div>
              <p className="m-0 text-[12px] font-bold text-muted-foreground">{v.sub}</p>
              {v.steps.length > 0 && (
                <ol className="m-0 flex list-none gap-1.5 p-0" aria-label="Where your return is">
                  {v.steps.map((st) => (
                    <li key={st.label} className="flex-1" aria-current={st.now ? 'step' : undefined}>
                      <div className={cn('h-1 rounded-full', st.done ? 'bg-foreground' : st.now ? 'bg-primary' : 'bg-slate-200')} />
                      <p className={cn('m-0 mt-1 text-[11px] font-bold leading-tight', st.done || st.now ? 'text-foreground' : 'text-muted-foreground')}>{st.label}<span className="sr-only">{st.done ? ', done' : st.now ? ', now' : ', next'}</span></p>
                    </li>))}
                </ol>)}
              <p className="m-0 text-[13px] font-bold text-foreground">{v.line}</p>
              {r.labelUrl && r.status === 'open' && (
                <a href={r.labelUrl} target="_blank" rel="noreferrer" className="flex h-11 w-full items-center justify-center rounded-xl bg-primary font-black uppercase text-[10px] tracking-widest text-primary-foreground">
                  Print your label{r.labelCarrier ? ` (${r.labelCarrier})` : ''}
                </a>)}
            </div>);
        })}
      </CardContent>
    </Card>);
}
