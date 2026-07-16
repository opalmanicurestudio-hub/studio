'use client';

/**
 * BoothAutomationSettings — v1  (the owner's rulebook)
 *
 * One surface where the owner defines HOW their rental business runs.
 * Every automation elsewhere (confirmations, reminders, reviews, tours,
 * cancellation, no-show, deposits) reads these rules instead of hardcoded
 * behavior — the difference between software that has features and
 * software that runs *your* business your way.
 *
 * Stored at tenants/{id}.bookingPageSettings.automationRules — beside the
 * page-builder config, already loaded with the tenant object. The Cloud
 * Functions (conciergeMessenger, boothAutomation, rentCollector) read the
 * same path so on-server automation obeys these settings too.
 *
 * Drop into your booths hub or a settings route:
 *   <BoothAutomationSettings tenantId={tenantId} firestore={firestore}
 *     initial={selectedTenant?.bookingPageSettings?.automationRules} />
 */

import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

// The canonical rulebook shape. Every field has a safe default so a
// tenant who never opens this screen still gets sensible behavior.
export const DEFAULT_AUTOMATION_RULES = {
  // ── Booking window ──
  bookingLeadHours: 2,           // min notice before a slot
  bookingHorizonDays: 60,        // how far ahead guests can book
  // ── Tours ──
  toursEnabled: true,
  tourAutoConfirm: true,         // false = tour requests need owner approval
  tourDurationMins: 30,
  tourDays: [1, 2, 3, 4, 5],     // weekdays tours are offered (0=Sun)
  tourWindowStart: '10:00',
  tourWindowEnd: '17:00',
  // ── Deposits & payment ──
  depositRequired: false,
  depositPercent: 25,
  // ── Cancellation ──
  cancellationEnabled: true,
  cancellationWindowHours: 24,   // free cancel if this far ahead
  noShowFeeCents: 0,             // 0 = none
  // ── Reminders & follow-up (all via SMS if Twilio configured) ──
  sendConfirmationSms: true,
  sendReminderSms: true,
  reminderHoursBefore: 24,
  askForReview: true,
  // ── House rules (shown on stay page + kiosk) ──
  houseRules: '',
} as const;

type Rules = typeof DEFAULT_AUTOMATION_RULES & Record<string, any>;

const WEEKDAYS = [['Sun', 0], ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6]] as const;

export function BoothAutomationSettings({
  tenantId, firestore, initial,
}: {
  tenantId: string;
  firestore: Firestore;
  initial?: Partial<Rules>;
}) {
  const [rules, setRules] = useState<Rules>({ ...DEFAULT_AUTOMATION_RULES, ...(initial || {}) });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof Rules>(k: K, v: Rules[K]) => { setRules(r => ({ ...r, [k]: v })); setSaved(false); };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId), { 'bookingPageSettings.automationRules': rules });
      setSaved(true);
    } catch { /* surface nothing destructive; the button state conveys it */ }
    finally { setSaving(false); }
  };

  const Toggle = ({ label, hint, k }: { label: string; hint?: string; k: keyof Rules }) => (
    <button type="button" onClick={() => set(k, !rules[k] as any)}
      className={`w-full rounded-2xl border-2 p-3.5 flex items-center gap-3 text-left transition-colors ${rules[k] ? 'border-slate-900 bg-slate-50' : 'border-slate-200'}`}>
      <span className={`w-11 h-6 rounded-full shrink-0 relative transition-colors ${rules[k] ? 'bg-slate-900' : 'bg-slate-200'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${rules[k] ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-black uppercase tracking-tight">{label}</span>
        {hint && <span className="block text-[10px] font-bold text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );

  const NumField = ({ label, k, suffix }: { label: string; k: keyof Rules; suffix?: string }) => (
    <div className="space-y-1">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <div className="flex items-center gap-2">
        <input type="number" value={rules[k] as any} onChange={e => set(k, Number(e.target.value) as any)}
          className="w-24 h-10 rounded-xl border-2 px-3 text-sm font-bold" />
        {suffix && <span className="text-[10px] font-bold text-muted-foreground uppercase">{suffix}</span>}
      </div>
    </div>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rounded-2xl border-2 bg-white p-4 space-y-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</p>
      {children}
    </div>
  );

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-xl font-black tracking-tight">Booking automation</h2>
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">Set the rules once — the system runs your business by them</p>
      </div>

      <Section title="Booking window">
        <div className="grid grid-cols-2 gap-4">
          <NumField label="Minimum notice" k="bookingLeadHours" suffix="hours ahead" />
          <NumField label="Book up to" k="bookingHorizonDays" suffix="days out" />
        </div>
      </Section>

      <Section title="Tours">
        <Toggle label="Offer tours" hint="Let prospects schedule a walk-through" k="toursEnabled" />
        {rules.toursEnabled && (
          <>
            <Toggle label="Auto-confirm tour requests" hint={rules.tourAutoConfirm ? 'Tours confirm instantly' : 'You approve each tour request'} k="tourAutoConfirm" />
            <div className="grid grid-cols-2 gap-4">
              <NumField label="Tour length" k="tourDurationMins" suffix="minutes" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Tour days</p>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map(([lbl, val]) => (
                  <button key={val} type="button"
                    onClick={() => set('tourDays', (rules.tourDays.includes(val) ? rules.tourDays.filter((d: number) => d !== val) : [...rules.tourDays, val]) as any)}
                    className={`h-9 px-3 rounded-full border-2 text-[10px] font-black uppercase transition-colors ${rules.tourDays.includes(val) ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-400'}`}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Tours from</p>
                <input type="time" value={rules.tourWindowStart} onChange={e => set('tourWindowStart', e.target.value)} className="w-full h-10 rounded-xl border-2 px-3 text-sm font-bold" />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Tours until</p>
                <input type="time" value={rules.tourWindowEnd} onChange={e => set('tourWindowEnd', e.target.value)} className="w-full h-10 rounded-xl border-2 px-3 text-sm font-bold" />
              </div>
            </div>
          </>
        )}
      </Section>

      <Section title="Deposits">
        <Toggle label="Require a deposit" hint="Collect a percentage up front on bookings" k="depositRequired" />
        {rules.depositRequired && <NumField label="Deposit amount" k="depositPercent" suffix="% of total" />}
      </Section>

      <Section title="Cancellation & no-shows">
        <Toggle label="Allow self-service cancellation" hint="Guests can request a cancel from their booking page" k="cancellationEnabled" />
        {rules.cancellationEnabled && <NumField label="Free-cancel window" k="cancellationWindowHours" suffix="hours before" />}
        <div className="space-y-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">No-show fee</p>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">$</span>
            <input type="number" value={(rules.noShowFeeCents / 100) || 0} onChange={e => set('noShowFeeCents', Math.round(Number(e.target.value) * 100) as any)}
              className="w-24 h-10 rounded-xl border-2 px-3 text-sm font-bold" />
            <span className="text-[10px] font-bold text-muted-foreground uppercase">0 = none</span>
          </div>
        </div>
      </Section>

      <Section title="Messages & follow-up">
        <Toggle label="Booking confirmation text" hint="SMS with details + check-in link when booked" k="sendConfirmationSms" />
        <Toggle label="Reminder text" hint="A nudge before the booking" k="sendReminderSms" />
        {rules.sendReminderSms && <NumField label="Remind" k="reminderHoursBefore" suffix="hours before" />}
        <Toggle label="Ask for a review" hint="Text 'how was your stay?' after checkout" k="askForReview" />
      </Section>

      <Section title="House rules">
        <p className="text-[10px] font-bold text-muted-foreground -mt-1">Shown on the booking page and kiosk. Guests acknowledge these before their visit.</p>
        <textarea rows={4} value={rules.houseRules} onChange={e => set('houseRules', e.target.value)}
          placeholder="Treat the space and equipment with care, keep your station clean, respect other professionals and their clients…"
          className="w-full rounded-xl border-2 px-4 py-3 text-sm font-medium" />
      </Section>

      <button onClick={save} disabled={saving}
        className="w-full h-13 py-3.5 rounded-2xl bg-slate-900 text-white font-black uppercase text-[11px] tracking-widest disabled:opacity-40 transition-opacity">
        {saving ? 'Saving…' : saved ? '✓ Saved — automations updated' : 'Save automation rules'}
      </button>
    </div>
  );
}
