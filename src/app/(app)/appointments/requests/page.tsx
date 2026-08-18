'use client';

// ─── /appointments/requests ───────────────────────────────────────────────────
// The queue approval mode creates. Its whole reason for existing is speed:
// approval is only a good experience for the client if the answer comes fast,
// and the owner is usually holding a phone with a client in the chair. So the
// page is one column of cards, biggest-first by urgency, with two big buttons
// and nothing else to read.
//
// Urgency here means TIME PRESSURE FROM BOTH ENDS: how soon the request will
// auto-expire (the client's day is on hold), and how soon the appointment
// itself starts (a request for tomorrow morning cannot wait until tomorrow).

import { collection, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { ArrowLeft, CalendarClock, Check, Loader, MessageSquare, TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type Req = {
  id: string;
  clientName?: string;
  serviceName?: string;
  staffName?: string;
  startTime?: string;
  requestedAt?: string;
  requestExpiresAt?: string | null;
  depositAmountCents?: number;
  hasCardOnFile?: boolean;
  notes?: string | null;
  inspirationPhotoUrl?: string | null;
  requiresCardOnFile?: boolean;
  bookingReason?: string;
};

const money = (c?: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;

function relative(iso?: string | null): { text: string; urgent: boolean; dead: boolean } {
  if (!iso) return { text: 'no expiry', urgent: false, dead: false };
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return { text: '', urgent: false, dead: false };
  if (ms <= 0) return { text: 'expired', urgent: true, dead: true };
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return { text: h > 0 ? `${h}h ${m}m left` : `${m}m left`, urgent: ms < 3 * 3600000, dead: false };
}

export default function BookingRequestsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { toast } = useToast();

  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const staffName = String((selectedTenant as any)?.staffMember?.name || 'The studio');

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(
      collection(firestore as Firestore, `tenants/${tenantId}/appointments`),
      where('status', '==', 'requested'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [firestore, tenantId]);

  /* Sort by whichever clock runs out first — the request's expiry or the
   * appointment itself. A request for tomorrow morning outranks one for next
   * month even if it arrived later. */
  const sorted = useMemo(() => {
    const key = (r: Req) => {
      const exp = r.requestExpiresAt ? Date.parse(r.requestExpiresAt) : Infinity;
      const start = r.startTime ? Date.parse(r.startTime) : Infinity;
      return Math.min(Number.isFinite(exp) ? exp : Infinity, Number.isFinite(start) ? start : Infinity);
    };
    return [...rows].sort((a, b) => key(a) - key(b));
  }, [rows]);

  const decide = async (r: Req, decision: 'accept' | 'decline', reason?: string) => {
    if (busy) return;
    setBusy(`${r.id}-${decision}`);
    try {
      const res = await fetch('/api/appointments/decide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, appointmentId: r.id, decision, staffName, reason: reason || '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ variant: 'destructive', title: 'Not recorded', description: data.error || 'Try again.' });
      } else {
        // A declined card is not a failure of the DECISION — the acceptance
        // stands and the client keeps their time — but the studio has to
        // actually see it, so it gets the loud toast rather than the quiet one.
        toast(data.chargeFailed
          ? { variant: 'destructive', title: 'Accepted — card declined', description: data.message }
          : { title: decision === 'accept' ? 'Accepted' : 'Declined', description: data.message });
        setDeclineFor(null);
        setDeclineReason('');
      }
    } catch {
      toast({ variant: 'destructive', title: 'Connection problem', description: 'Nothing was changed — try again.' });
    } finally { setBusy(null); }
  };

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/appointments"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Booking requests</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              {loading ? 'Loading…' : sorted.length === 0 ? 'Nothing waiting' : `${sorted.length} waiting on you`}
            </p>
          </div>
          <CalendarClock className="h-5 w-5 text-muted-foreground" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-3">
        {loading && (
          <p className="py-20 text-center text-[10px] font-black uppercase tracking-widest opacity-30">Loading…</p>
        )}

        {!loading && sorted.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed py-20 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest opacity-30">No requests waiting</p>
            <p className="mx-auto mt-2 max-w-xs text-[11px] font-bold leading-relaxed text-muted-foreground">
              When approval mode is on, requests land here. Answer fast — the client&apos;s day is on hold until you do.
            </p>
          </div>
        )}

        {sorted.map((r) => {
          const exp = relative(r.requestExpiresAt);
          const start = r.startTime
            ? new Date(r.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : 'Time not set';
          const soon = r.startTime ? Date.parse(r.startTime) - Date.now() < 48 * 3600000 : false;
          return (
            <Card key={r.id} className={cn('border-2 rounded-[2rem] bg-white overflow-hidden', exp.urgent && 'border-amber-400')}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-base font-black leading-tight">{r.clientName || 'A client'}</p>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
                      {r.serviceName || 'Service'}{r.staffName ? ` · ${r.staffName}` : ''}
                    </p>
                  </div>
                  <span className={cn('shrink-0 rounded-full border-2 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest',
                    exp.dead ? 'border-red-300 bg-red-50 text-red-700'
                      : exp.urgent ? 'border-amber-300 bg-amber-50 text-amber-700'
                        : 'border-border bg-muted/30 text-muted-foreground')}>
                    {exp.text}
                  </span>
                </div>

                <p className={cn('text-sm font-black', soon && 'text-amber-700')}>
                  {start}{soon ? ' · soon' : ''}
                </p>

                {(Number(r.depositAmountCents) || 0) > 0 && (
                  <p className="rounded-xl border-2 border-dashed px-2.5 py-1.5 text-[10px] font-bold leading-relaxed text-muted-foreground">
                    {money(r.depositAmountCents)} deposit — <strong>not charged yet</strong>.{' '}
                    {r.hasCardOnFile
                      ? 'They have a card on file, so accepting charges it straight away.'
                      : 'Accepting sends them a link to pay it.'}
                  </p>
                )}
                {r.requiresCardOnFile && (
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Card on file required</p>
                )}

                {r.notes && (
                  <p className="flex items-start gap-1.5 rounded-xl bg-muted/40 px-2.5 py-2 text-[11px] font-bold leading-relaxed">
                    <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 opacity-50" />
                    <span className="whitespace-pre-wrap">{r.notes}</span>
                  </p>
                )}
                {r.inspirationPhotoUrl && (
                  <a href={r.inspirationPhotoUrl} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.inspirationPhotoUrl} alt="Inspiration from the client"
                      className="h-28 w-28 rounded-xl border-2 object-cover" />
                  </a>
                )}

                {declineFor === r.id ? (
                  <div className="space-y-2">
                    <Textarea value={declineReason} rows={2}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDeclineReason(e.target.value)}
                      placeholder="Optional — what should they know? (Sent to them.)"
                      className="rounded-xl border-2 text-sm font-bold" />
                    <div className="flex gap-2">
                      <Button variant="destructive" disabled={busy === `${r.id}-decline`}
                        onClick={() => void decide(r, 'decline', declineReason)}
                        className="h-11 flex-1 rounded-2xl font-black uppercase text-[10px] tracking-widest">
                        {busy === `${r.id}-decline` ? <Loader className="h-4 w-4 animate-spin" /> : 'Send decline'}
                      </Button>
                      <Button variant="outline" onClick={() => { setDeclineFor(null); setDeclineReason(''); }}
                        className="h-11 rounded-2xl border-2 px-4 font-black uppercase text-[10px] tracking-widest">
                        Back
                      </Button>
                    </div>
                    <p className="text-[10px] font-bold leading-relaxed text-muted-foreground">
                      They will be told nothing was charged and invited to pick another time.
                    </p>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button disabled={busy === `${r.id}-accept`} onClick={() => void decide(r, 'accept')}
                      className="h-12 flex-1 rounded-2xl font-black uppercase text-[10px] tracking-widest">
                      {busy === `${r.id}-accept` ? <Loader className="h-4 w-4 animate-spin" /> : <><Check className="mr-1.5 h-4 w-4" /> Accept</>}
                    </Button>
                    <Button variant="outline" onClick={() => setDeclineFor(r.id)}
                      className="h-12 rounded-2xl border-2 px-5 font-black uppercase text-[10px] tracking-widest">
                      <X className="mr-1.5 h-4 w-4" /> Decline
                    </Button>
                  </div>
                )}

                {exp.dead && (
                  <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-red-700">
                    <TriangleAlert className="h-3 w-3" /> Past its expiry — the slot is already free
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </main>
    </div>
  );
}
