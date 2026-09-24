'use client';
// src/components/clients/MessagingConsentCard.tsx
//
// MESSAGING CONSENT, ON THE CLIENT PROFILE.
//
// Two different yeses live on a client, and this card shows both plainly:
//
//   Reminder texts  — given on the booking sheet ("appointment reminders and
//                     confirmations by text"). Read-only here: it comes from
//                     the client, with the exact words they agreed to.
//   Marketing texts — offers, openings, "we miss you". Campaign and Reconnect
//                     texts go ONLY to clients with this yes. Clients give it
//                     on the booking sheet; staff can record one the client
//                     gave in person — and this card makes that a deliberate
//                     act: a phone number must be on file, the staff member
//                     says how the client agreed, and ticks that they did.
//
// Every change is appended to client.consentLog (who, when, how, the number
// it applied to), newest first, capped at 30 — the record you'd want if a
// carrier or a client ever asks how the number came to be texted.

import { useState } from 'react';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { MessageSquare, CheckCircle2, Ban, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const METHODS: [string, string][] = [
  ['in_person', 'Told us in person'],
  ['phone_call', 'Told us on a phone call'],
  ['written_form', 'Signed a paper form'],
  ['text_reply', 'Replied YES to a text'],
];

const when = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : format(d, 'MMM d, yyyy · h:mm a'); };

export function MessagingConsentCard({ firestore, tenantId, client, staffName, staffUid, studioName }: {
  firestore: any; tenantId: string; client: any; staffName: string; staffUid: string | null; studioName?: string | null;
}) {
  const [mode, setMode] = useState<'yes' | 'no' | null>(null);
  const [method, setMethod] = useState('in_person');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [resubscribe, setResubscribe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const phone = String(client?.phone || '').trim();
  const reminder = client?.smsConsent || null;
  const marketingYes = client?.smsMarketingOptIn === true;
  const unsubscribed = client?.marketingOptOut === true;
  const log: any[] = Array.isArray(client?.consentLog) ? [...client.consentLog].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 30) : [];

  const open = (m: 'yes' | 'no') => { setMode(m); setMethod('in_person'); setNote(''); setConfirmed(false); setResubscribe(false); setErr(''); };

  const save = async () => {
    if (!firestore || !tenantId || !client?.id || !mode) return;
    if (mode === 'yes') {
      if (!phone) { setErr('Add a mobile number to their profile first — consent applies to a specific number.'); return; }
      if (!confirmed) { setErr('Tick the confirmation — it’s the part that makes this a record of consent.'); return; }
      if (unsubscribed && !resubscribe) { setErr('They unsubscribed before. Only record a yes if they asked to hear from you again — tick that box to confirm.'); return; }
    }
    setBusy(true); setErr('');
    const now = new Date().toISOString();
    const entry = {
      at: now, kind: 'sms_marketing', value: mode === 'yes', source: 'staff', method: mode === 'yes' ? method : 'staff_recorded_withdrawal',
      by: staffName || 'Staff', byUid: staffUid || null, phone: phone || null, note: note.trim().slice(0, 300) || null,
      ...(mode === 'yes' && unsubscribed ? { resubscribed: true } : {}),
    };
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/clients`, client.id), {
        ...(mode === 'yes'
          ? { smsMarketingOptIn: true, smsMarketingOptInAt: now, smsMarketingOptInSource: 'staff', smsMarketingOptInBy: staffName || 'Staff', smsMarketingOptInMethod: method, smsMarketingOptInText: `Recorded by ${staffName || 'staff'}: ${METHODS.find((m) => m[0] === method)?.[1] || method}${note.trim() ? ` — ${note.trim()}` : ''}`,
              ...(unsubscribed ? { marketingOptOut: false, reconnectOptOut: false, resubscribedAt: now } : {}) }
          : { smsMarketingOptIn: false, smsMarketingOptOutAt: now, smsMarketingOptOutBy: staffName || 'Staff' }),
        consentLog: arrayUnion(entry),
      });
      setMode(null);
    } catch (e: any) {
      setErr(e?.message || 'Could not save that.');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 pt-6 border-t border-dashed text-left">
      <h3 className="text-sm font-black uppercase tracking-[0.2em] text-primary flex items-center gap-3 text-left px-1">
        <MessageSquare className="w-5 h-5" />Text Messages
      </h3>

      {/* Reminders — the client's own consent, read-only. */}
      <div className={cn('p-5 rounded-[2rem] border-2 flex items-start justify-between gap-3', reminder?.agreed ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200')}>
        <div className="min-w-0">
          <p className={cn('font-black text-xs uppercase tracking-tight', reminder?.agreed ? 'text-green-700' : 'text-slate-600')}>
            Reminder texts: {reminder?.agreed ? 'Agreed' : 'Not recorded'}
          </p>
          <p className="text-[10px] font-bold text-muted-foreground mt-1">
            {reminder?.agreed ? `On the booking sheet · ${when(reminder.at)}` : 'Given by the client when they book online. Appointment confirmations and reminders only.'}
          </p>
        </div>
        {reminder?.agreed ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" /> : <Ban className="w-5 h-5 text-slate-400 shrink-0" />}
      </div>

      {/* Marketing — what Campaigns and Reconnect need to text them. */}
      <div className={cn('p-5 rounded-[2rem] border-2 space-y-3', marketingYes ? 'bg-green-50 border-green-200' : unsubscribed ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cn('font-black text-xs uppercase tracking-tight', marketingYes ? 'text-green-700' : unsubscribed ? 'text-amber-800' : 'text-slate-600')}>
              Offers &amp; check-ins by text: {marketingYes ? 'Yes' : unsubscribed ? 'Unsubscribed' : 'No'}
            </p>
            <p className="text-[10px] font-bold text-muted-foreground mt-1">
              {marketingYes
                ? `${client.smsMarketingOptInSource === 'staff' ? `Recorded by ${client.smsMarketingOptInBy || 'staff'}` : 'Ticked on the booking sheet'} · ${when(client.smsMarketingOptInAt)}`
                : unsubscribed ? 'They used an unsubscribe link. No campaigns or check-ins — by text or email — until they ask again.'
                : 'Campaign and Reconnect texts skip them. Emails still go to them unless they unsubscribe.'}
            </p>
          </div>
          {marketingYes ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" /> : <Ban className="w-5 h-5 text-slate-400 shrink-0" />}
        </div>
        <div className="flex flex-wrap gap-2">
          {!marketingYes && <Button size="sm" variant="outline" className="rounded-xl" onClick={() => open('yes')}><ShieldCheck className="w-3.5 h-3.5 mr-1.5" />Record their yes</Button>}
          {marketingYes && <Button size="sm" variant="ghost" className="rounded-xl text-muted-foreground" onClick={() => open('no')}>They asked to stop</Button>}
        </div>
      </div>

      {log.length > 0 && (
        <details className="px-1">
          <summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-muted-foreground">Consent history ({log.length})</summary>
          <div className="mt-2 space-y-1">
            {log.map((e, i) => (
              <p key={i} className="text-[11px] text-muted-foreground">
                <span className="font-bold text-foreground">{when(e.at)}</span> · {e.value ? 'Yes' : 'Stopped'} to marketing texts · {e.by}
                {e.method && e.value ? ` · ${METHODS.find((m) => m[0] === e.method)?.[1] || e.method}` : ''}{e.phone ? ` · ${e.phone}` : ''}{e.resubscribed ? ' · resubscribed' : ''}{e.note ? ` — “${e.note}”` : ''}
              </p>
            ))}
          </div>
        </details>
      )}

      <Dialog open={!!mode} onOpenChange={(o) => { if (!o) setMode(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === 'yes' ? 'Record a yes to marketing texts' : 'Record that they asked to stop'}</DialogTitle>
            <DialogDescription>
              {mode === 'yes'
                ? `Only when ${client?.name || 'the client'} told you they want offers and check-ins by text. It applies to ${phone || 'their mobile number'}.`
                : 'Campaign and Reconnect texts stop straight away. Reminders about booked visits are separate and keep going.'}
            </DialogDescription>
          </DialogHeader>
          {mode === 'yes' && (
            <div className="space-y-3">
              {!phone && <p className="rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">No mobile number on their profile — add one first.</p>}
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">How did they agree?</Label>
                <div className="grid grid-cols-2 gap-2">
                  {METHODS.map(([k, l]) => (
                    <button key={k} type="button" aria-pressed={method === k} onClick={() => setMethod(k)} className={cn('h-10 rounded-xl border-2 px-2 text-[11px] font-bold', method === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600')}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Note (optional)</Label>
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} placeholder="e.g. Asked to hear about last-minute openings" />
              </div>
              {unsubscribed && (
                <label className="flex items-start gap-2 rounded-xl border-2 border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={resubscribe} onChange={(e) => setResubscribe(e.target.checked)} />
                  They unsubscribed before, and have asked to hear from {studioName || 'us'} again.
                </label>
              )}
              <label className="flex items-start gap-2 rounded-xl border-2 p-3 text-xs font-bold cursor-pointer">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                I confirm {client?.name || 'this client'} agreed to receive marketing texts from {studioName || 'us'} at {phone || 'this number'}, and knows they can reply STOP at any time.
              </label>
              <p className="text-[10px] text-muted-foreground">Recorded as {staffName || 'you'}, with today’s date and time.</p>
            </div>
          )}
          {err && <p className="text-sm font-bold text-red-700">{err}</p>}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setMode(null)}>Cancel</Button>
            <Button disabled={busy || (mode === 'yes' && (!phone || !confirmed))} onClick={save} variant={mode === 'no' ? 'destructive' : 'default'}>
              {busy ? 'Saving…' : mode === 'yes' ? 'Record yes' : 'Record stop'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
