'use client';

// src/components/shared/CommsTrail.tsx
//
// v17 — THE REUSABLE COMMUNICATIONS TRAIL. Drop this one line into any
// detail view to show every email/text the platform sent that person,
// with the delivery journey (Sent → Delivered → Opened → Clicked) or the
// failure reason in plain English:
//
//   <CommsTrail recipientType="renter" recipientId={renter.id} />
//
// Works for renters, staff, maintenance workers, and clients — anything
// the sending layer tags (or auto-matches by phone number). Reads
// tenants/{id}/messageLog with a single equality filter (no index needed)
// and finds firestore/tenant from context, so callers pass nothing else.

import React, { useMemo, useState } from 'react';
import { Mail, MessageSquare, Send, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react';
import { collection, query, where } from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { cn } from '@/lib/utils';

const fmtDT = (iso: any) => {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  } catch { return ''; }
};

const STEPS = ['Sent', 'Delivered', 'Opened', 'Clicked'];

/** Full stamp for the moments people actually ask about. */
const fmtFull = (iso: any) => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  } catch { return ''; }
};

// Best-effort E.164 for matching messageLog's stored `to` numbers.
const toE164ish = (raw: any): string | null => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.length >= 10 ? `+${digits}` : null;
};

export function CommsTrail({
  recipientType,
  recipientId,
  contactPhone,
  contactEmail,
  title = 'Communications',
  maxItems = 8,
}: {
  recipientType: 'client' | 'staff' | 'renter' | 'maintenance' | 'contact';
  recipientId: string;
  // Optional: also match by the person's phone/email — catches messages
  // sent before their record existed (or before the tagging deploy).
  contactPhone?: string;
  contactEmail?: string;
  title?: string;
  maxItems?: number;
}) {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;
  const [open, setOpen] = useState(false);

  const logQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !recipientId) return null;
    return query(collection(firestore, `tenants/${tenantId}/messageLog`), where('recipientId', '==', recipientId));
  }, [firestore, tenantId, recipientId]);
  const { data: docs } = useCollection<any>(logQuery);

  const phoneE164 = toE164ish(contactPhone);
  const phoneQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !phoneE164) return null;
    return query(collection(firestore, `tenants/${tenantId}/messageLog`), where('to', '==', phoneE164));
  }, [firestore, tenantId, phoneE164]);
  const { data: phoneDocs } = useCollection<any>(phoneQuery);

  const emailNorm = String(contactEmail || '').trim().toLowerCase();
  const emailQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId || !emailNorm || !emailNorm.includes('@')) return null;
    return query(collection(firestore, `tenants/${tenantId}/messageLog`), where('to', '==', emailNorm));
  }, [firestore, tenantId, emailNorm]);
  const { data: emailDocs } = useCollection<any>(emailQuery);

  const messages = useMemo(() => {
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const m of [...(docs || []), ...(phoneDocs || []), ...(emailDocs || [])]) {
      if (!m?.id || seen.has(m.id)) continue;
      seen.add(m.id);
      merged.push(m);
    }
    return merged
      .sort((a: any, b: any) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')))
      .slice(0, maxItems);
  }, [docs, phoneDocs, emailDocs, maxItems]);

  const attention = messages.filter((m: any) => m.bouncedAt || m.status === 'failed').length;
  if (!recipientId) return null;

  return (
    <div className="rounded-2xl border-2 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2.5 flex items-center justify-between gap-2 bg-white">
        <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-600">
          <Send className="w-3 h-3 text-primary" /> {title}
          <span className="rounded-full border-2 px-1.5 text-[8px]">{messages.length}</span>
          {attention > 0 && (
            <span className="rounded-full border-2 border-red-200 bg-red-50 text-red-700 px-1.5 text-[8px]">{attention} failed</span>
          )}
        </span>
        <ChevronDown className={cn('w-3.5 h-3.5 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 bg-white">
          {messages.length === 0 && (
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest text-center py-2">Nothing sent yet</p>
          )}
          {messages.map((m: any) => {
            const failed = !!(m.bouncedAt || m.status === 'failed');
            const skipped = m.status === 'skipped_no_provider';
            const stage = failed ? 'Failed' : m.clickedAt ? 'Clicked' : m.openedAt ? 'Opened' : m.deliveredAt ? 'Delivered' : skipped ? 'Skipped' : 'Sent';
            const reached = STEPS.indexOf(stage);
            return (
              <div key={m.id} className={cn('rounded-xl border-2 p-2.5', failed ? 'border-red-200 bg-red-50/50' : 'bg-slate-50/50')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-tight flex items-center gap-1.5">
                      {m.channel === 'sms' ? <MessageSquare className="w-3 h-3 text-primary shrink-0" /> : <Mail className="w-3 h-3 text-primary shrink-0" />}
                      <span className="truncate">{String(m.kind || 'message').replace(/_/g, ' ')}</span>
                    </p>
                    <p className="text-[8px] font-bold text-slate-500 mt-0.5 break-all">{m.to || '—'}</p>
                    {(m.subject || m.preview) && (
                      <p className="text-[8px] font-medium text-slate-400 mt-0.5 line-clamp-1 italic">{m.subject || m.preview}</p>
                    )}
                  </div>
                  <span className="text-[7px] font-bold text-slate-400 uppercase tracking-wide shrink-0 whitespace-nowrap">
                    {m.sentAt ? fmtDT(m.sentAt) : ''}
                  </span>
                </div>
                {!failed && !skipped && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {(m.channel === 'sms' ? STEPS.slice(0, 2) : STEPS).map((s, i) => (
                      <span key={s} className={cn(
                        'px-1.5 h-4 inline-flex items-center rounded-full text-[7px] font-black uppercase tracking-wide border',
                        i <= reached ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-white text-slate-300 border-slate-100',
                      )}>
                        {i <= reached ? <CheckCircle2 className="w-2 h-2 mr-0.5" /> : null}{s}
                      </span>
                    ))}
                  </div>
                )}
                {!failed && !skipped && (
                  <div className="mt-1.5 space-y-0.5">
                    {([
                      ['Sent', m.sentAt, null],
                      ['Delivered', m.deliveredAt, null],
                      ['Opened', m.firstOpenedAt || m.openedAt, m.openCount],
                      ['Clicked', m.firstClickedAt || m.clickedAt, m.clickCount],
                    ] as const).map(([label, at, count]) => at ? (
                      <p key={label} className="text-[8px] font-bold text-slate-500">
                        <span className="uppercase tracking-wide text-slate-400">{label}</span>{' '}
                        {fmtFull(at)}
                        {typeof count === 'number' && count > 1 ? ` · ${count}×` : ''}
                        {label === 'Opened' && m.firstOpenedAt && m.openedAt && m.openedAt !== m.firstOpenedAt
                          ? ` · last ${fmtFull(m.openedAt)}` : ''}
                      </p>
                    ) : null)}
                  </div>
                )}
                {failed && (
                  <p className="text-[8px] font-black text-red-700 mt-1.5 flex items-start gap-1">
                    <AlertCircle className="w-2.5 h-2.5 shrink-0 mt-px" />
                    {m.failureDetail || m.error || 'Not delivered — check the address or number.'}
                  </p>
                )}
                {skipped && (
                  <p className="text-[8px] font-black text-amber-700 mt-1.5">Skipped — provider not configured.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default CommsTrail;
