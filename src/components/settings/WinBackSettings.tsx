'use client';
// src/components/settings/WinBackSettings.tsx — WIN BACK QUIET CLIENTS + RENTER CAMPAIGNS.
// Moved from Settings → "Recovery & money owed" to Messages: they're messages.
// Each field saves as it changes (same as the rest of the Messages page).
import React, { useEffect, useRef, useState } from 'react';
import { doc, updateDoc, collection, getDocs, query, where, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

function Tally({ tenantId }: { tenantId: string }) {
  const { firestore } = useFirebase() as any;
  const [t, setT] = useState<{ sent: number; converted: number; due: number; miss: number } | null>(null);
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    getDocs(query(collection(firestore, `tenants/${tenantId}/reconnectNudges`), where('sender', '==', 'studio')))
      .then((snap) => { const rows = snap.docs.map((d) => d.data() as any).filter((x) => String(x.sentAt || '') >= since);
        setT({ sent: rows.length, converted: rows.filter((x) => x.converted).length, due: rows.filter((x) => x.kind === 'due').length, miss: rows.filter((x) => x.kind === 'miss_you').length }); })
      .catch(() => setT({ sent: 0, converted: 0, due: 0, miss: 0 }));
  }, [firestore, tenantId]);
  if (!t) return null;
  return <p className="text-sm text-muted-foreground">Last 30 days: {t.sent} nudge{t.sent === 1 ? '' : 's'} sent ({t.due} “you’re due”, {t.miss} “we miss you”) · {t.converted} rebooked within 14 days{t.sent ? ` (${Math.round((t.converted / t.sent) * 100)}%)` : ''}.</p>;
}

export function WinBackSettings({ tenantId, tenant, canEdit }: { tenantId: string; tenant: any; canEdit: boolean }) {
  const { firestore } = useFirebase() as any; const { toast } = useToast();
  const r = tenant?.reconnect || {}; const rc = tenant?.renterCampaigns || {};
  const timers = useRef<Record<string, any>>({});
  // Save one field (dot path). Typing fields wait a moment; switches save at once.
  const save = (field: string, value: any, delay = 0) => {
    clearTimeout(timers.current[field]);
    timers.current[field] = setTimeout(async () => {
      try { await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { [field]: value }); }
      catch { toast({ variant: 'destructive', title: 'Couldn’t save that change' }); }
    }, delay);
  };
  const [local, setLocal] = useState<Record<string, any>>({});
  const v = (field: string, fallback: any) => (field in local ? local[field] : fallback);
  const typed = (field: string, value: any) => { setLocal((l) => ({ ...l, [field]: value })); save(field, value, 700); };
  const box = 'rounded-2xl border bg-white p-4 space-y-3';
  const num = 'h-10 w-24 rounded-xl border px-3 text-sm';
  return (
    <div className="space-y-4">
      <section id="winback" className={box}>
        <div className="flex items-center justify-between gap-3">
          <div><p className="font-semibold">Win back quiet clients</p><p className="text-sm text-muted-foreground">A text (or email, if there’s no phone) at your reminder hour. Never to someone with a visit booked, who opted out, or who was nudged recently.</p></div>
          <a href="/settings/automations#sw:win-back" className="shrink-0 text-[13.5px] font-medium underline underline-offset-4">{r.enabled === true ? 'On' : 'Off'} — change in Automations</a>
        </div>
        {r.enabled === true && <>
          <label className="flex flex-wrap items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit} checked={r.dueEnabled !== false} onChange={(e) => save('reconnect.dueEnabled', e.target.checked)} />
            <b>You’re due</b> — when a client is <input type="number" min={0} max={30} className={num} disabled={!canEdit} value={v('reconnect.dueGraceDays', r.dueGraceDays ?? 3)} onChange={(e) => typed('reconnect.dueGraceDays', Math.max(0, Math.min(30, Number(e.target.value) || 0)))} /> days past the service’s “rebook every” (set on each service)</label>
          <label className="flex flex-wrap items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit} checked={r.missEnabled !== false} onChange={(e) => save('reconnect.missEnabled', e.target.checked)} />
            <b>We miss you</b> — once, after no visit for <input type="number" min={3} max={104} className={num} disabled={!canEdit} value={v('reconnect.missWeeks', r.missWeeks ?? 10)} onChange={(e) => typed('reconnect.missWeeks', Math.max(3, Math.min(104, Number(e.target.value) || 3)))} /> weeks</label>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">At least <input type="number" min={7} max={180} className={num} disabled={!canEdit} value={v('reconnect.minDaysBetween', r.minDaysBetween ?? 21)} onChange={(e) => typed('reconnect.minDaysBetween', Math.max(7, Math.min(180, Number(e.target.value) || 7)))} /> days between nudges</label>
            <label className="flex items-center gap-2">At most <input type="number" min={1} max={200} className={num} disabled={!canEdit} value={v('reconnect.dailyCap', r.dailyCap ?? 25)} onChange={(e) => typed('reconnect.dailyCap', Math.max(1, Math.min(200, Number(e.target.value) || 1)))} /> a day</label>
          </div>
          <p className="text-sm text-muted-foreground">Your own words (optional) — you can use {'{first} {service} {weeks} {link}'}</p>
          <input className="h-10 w-full rounded-xl border px-3 text-sm" disabled={!canEdit} value={v('reconnect.dueMessage', r.dueMessage || '')} onChange={(e) => typed('reconnect.dueMessage', e.target.value.slice(0, 320))} placeholder="“You’re due” — blank uses: Hi {first}! It’s been {weeks} weeks since your {service} — ready for a refresh? {link}" />
          <input className="h-10 w-full rounded-xl border px-3 text-sm" disabled={!canEdit} value={v('reconnect.missMessage', r.missMessage || '')} onChange={(e) => typed('reconnect.missMessage', e.target.value.slice(0, 320))} placeholder="“We miss you” — blank uses: Hi {first}, it’s been a little while and we’d love to see you again. {link}" />
          <Tally tenantId={tenantId} />
        </>}
      </section>
      <section className={box}>
        <p className="font-semibold">Renter campaigns</p>
        <p className="text-sm text-muted-foreground">Can renters send their own campaigns, and who pays for the texts. They send to their own clients only, in their own name, with the same consent, monthly limit and quiet-hour rules as yours. Emails are always free.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {([['off', 'Off', 'Renters can’t send campaigns'], ['business_covers', 'We cover some', 'A monthly allowance of texts per renter; they pay beyond it'], ['renter_pays', 'Renters pay', 'Every text is charged to the renter']] as const).map(([k, l, d]) => {
            const on = (rc.mode || 'off') === k;
            return <button key={k} type="button" disabled={!canEdit} aria-pressed={on} onClick={() => save('renterCampaigns.mode', k)} className={`rounded-2xl border p-3 text-left text-sm disabled:opacity-60 ${on ? 'bg-slate-900 text-white' : 'bg-white'}`}><b>{l}</b><span className="mt-1 block opacity-80">{d}</span></button>;
          })}
        </div>
        {rc.mode && rc.mode !== 'off' && <div className="flex flex-wrap gap-4 text-sm">
          {rc.mode === 'business_covers' && <label className="flex items-center gap-2"><input type="number" min={0} max={5000} className={num} disabled={!canEdit} value={v('renterCampaigns.monthlyTexts', rc.monthlyTexts ?? 100)} onChange={(e) => typed('renterCampaigns.monthlyTexts', Math.max(0, Math.min(5000, Number(e.target.value) || 0)))} /> free texts per renter a month</label>}
          <label className="flex items-center gap-2"><input type="number" min={1} max={50} className={num} disabled={!canEdit} value={v('renterCampaigns.priceCentsPerText', rc.priceCentsPerText ?? 2)} onChange={(e) => typed('renterCampaigns.priceCentsPerText', Math.max(1, Math.min(50, Number(e.target.value) || 1)))} /> ¢ per paid text</label>
        </div>}
        <label className="flex items-center gap-2 text-sm"><input type="number" step="0.1" min={0.5} max={10} className={num} disabled={!canEdit} value={v('smsCostCentsPerSegment', tenant?.smsCostCentsPerSegment ?? 1.3)} onChange={(e) => typed('smsCostCentsPerSegment', Math.max(0.5, Math.min(10, parseFloat(e.target.value) || 1.3)))} /> ¢ — what a text costs you (for estimates)</label>
      </section>
    </div>
  );
}
