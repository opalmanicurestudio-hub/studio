'use client';

import { SettingsPage } from '@/components/settings/settings-ui';
import React, { useState, useEffect } from 'react';
import { AutomationsOverview } from '@/components/settings/AutomationsOverview';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle, Zap, Clock, FileSignature, CreditCard, Image,
  Heart, Wallet, CheckCircle2, Info, Save, Loader,
} from 'lucide-react';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { doc, setDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

// ─── Types ────────────────────────────────────────────────────────────────────
export type AutomationSeverity = 'warn' | 'require' | 'auto_cancel';

export type AutomationTrigger = {
  enabled:          boolean;
  severity:         AutomationSeverity;
  firstWindowHours: number;   // hours before appointment to send first reminder
  secondWindowHours?: number; // hours before to escalate / auto-cancel
  canDisable:       boolean;  // some triggers (health form) cannot be disabled
};

export type AppointmentAutomations = {
  depositNotPaid:        AutomationTrigger;
  consentFormUnsigned:   AutomationTrigger;
  noCardOnFile:          AutomationTrigger;
  referencePhotosMissing: AutomationTrigger;
  healthFormMissing:     AutomationTrigger;
  outstandingBalance:    AutomationTrigger;
};

const DEFAULT_AUTOMATIONS: AppointmentAutomations = {
  depositNotPaid: {
    enabled: true, severity: 'auto_cancel',
    firstWindowHours: 24, secondWindowHours: 48, canDisable: true,
  },
  consentFormUnsigned: {
    enabled: true, severity: 'require',
    firstWindowHours: 48, secondWindowHours: 2, canDisable: true,
  },
  noCardOnFile: {
    enabled: true, severity: 'warn',
    firstWindowHours: 72, secondWindowHours: 24, canDisable: true,
  },
  referencePhotosMissing: {
    enabled: true, severity: 'warn',
    firstWindowHours: 48, canDisable: true,
  },
  healthFormMissing: {
    enabled: true, severity: 'require',
    firstWindowHours: 48, secondWindowHours: 0, canDisable: false, // cannot disable
  },
  outstandingBalance: {
    enabled: true, severity: 'require',
    firstWindowHours: 0, canDisable: true, // fires at booking attempt
  },
};

// ─── Severity config ──────────────────────────────────────────────────────────
const SEVERITY_OPTIONS: { value: AutomationSeverity; label: string; description: string; color: string }[] = [
  {
    value: 'warn',
    label: 'Warn only',
    description: 'Send reminder to client, flag in dashboard. Appointment proceeds.',
    color: 'text-amber-700',
  },
  {
    value: 'require',
    label: 'Block service',
    description: 'Staff cannot start service until requirement is met at check-in.',
    color: 'text-orange-700',
  },
  {
    value: 'auto_cancel',
    label: 'Auto-cancel',
    description: 'Appointment is cancelled, slot released, cancellation policy fires.',
    color: 'text-red-700',
  },
];

// ─── Trigger definitions ──────────────────────────────────────────────────────
const TRIGGER_DEFS: {
  key: keyof AppointmentAutomations;
  icon: React.ReactNode;
  label: string;
  description: string;
  scheduleImpact: string;
  badgeColor: string;
  hasSecondWindow: boolean;
  secondWindowLabel?: string;
}[] = [
  {
    key: 'depositNotPaid',
    icon: <CreditCard className="w-4 h-4" />,
    label: 'Deposit not paid',
    description: 'Client has not paid the required deposit after booking.',
    scheduleImpact: 'Hard block — service cannot start. Slot wasted if not resolved.',
    badgeColor: 'bg-red-100 text-red-700',
    hasSecondWindow: true,
    secondWindowLabel: 'Auto-cancel if still unpaid',
  },
  {
    key: 'consentFormUnsigned',
    icon: <FileSignature className="w-4 h-4" />,
    label: 'Consent form not signed',
    description: 'Required consent form has not been completed via the link.',
    scheduleImpact: 'Soft delay — collecting on-site takes 5-10 min, ripples next client.',
    badgeColor: 'bg-orange-100 text-orange-700',
    hasSecondWindow: true,
    secondWindowLabel: 'Escalate / collect on-site gate',
  },
  {
    key: 'noCardOnFile',
    icon: <CreditCard className="w-4 h-4" />,
    label: 'No card on file',
    description: 'Client has not saved a card for late cancellation / no-show protection.',
    scheduleImpact: 'Exposure risk — cannot charge fees if client no-shows.',
    badgeColor: 'bg-purple-100 text-purple-700',
    hasSecondWindow: true,
    secondWindowLabel: 'Require at check-in',
  },
  {
    key: 'referencePhotosMissing',
    icon: <Image className="w-4 h-4" />,
    label: 'Reference photos not uploaded',
    description: 'Inspo / nail art reference photos were requested but not received.',
    scheduleImpact: 'Time cost — 10-15 min design consultation eats into service time.',
    badgeColor: 'bg-teal-100 text-teal-700',
    hasSecondWindow: false,
  },
  {
    key: 'healthFormMissing',
    icon: <Heart className="w-4 h-4" />,
    label: 'Health / allergy disclosure missing',
    description: 'Client has not disclosed allergies or medical conditions before chemical service.',
    scheduleImpact: 'Liability risk — applying product without disclosure. Cannot be waived.',
    badgeColor: 'bg-red-100 text-red-700',
    hasSecondWindow: false,
  },
  {
    key: 'outstandingBalance',
    icon: <Wallet className="w-4 h-4" />,
    label: 'Outstanding balance',
    description: 'Client has unpaid fees from prior appointments.',
    scheduleImpact: 'Future bookings blocked. No impact on current appointment.',
    badgeColor: 'bg-amber-100 text-amber-700',
    hasSecondWindow: false,
  },
];

const WINDOW_OPTIONS = [
  { value: 0,   label: 'Immediately (at booking)' },
  { value: 1,   label: '1 hour before' },
  { value: 2,   label: '2 hours before' },
  { value: 6,   label: '6 hours before' },
  { value: 12,  label: '12 hours before' },
  { value: 24,  label: '24 hours before' },
  { value: 48,  label: '48 hours before' },
  { value: 72,  label: '72 hours before' },
  { value: 168, label: '1 week before' },
];

// ─── Single trigger card ──────────────────────────────────────────────────────
function TriggerCard({
  def,
  value,
  onChange,
}: {
  def: typeof TRIGGER_DEFS[0];
  value: AutomationTrigger;
  onChange: (v: AutomationTrigger) => void;
}) {
  const severityDef = SEVERITY_OPTIONS.find(s => s.value === value.severity)!;
  const isLocked    = !def.hasSecondWindow && def.key === 'healthFormMissing';

  return (
    <Card className={cn(
      'border-2 rounded-[1.5rem] overflow-hidden transition-all',
      value.enabled ? 'border-border/80 bg-white' : 'border-border/30 bg-muted/5 opacity-60'
    )}>
      <CardContent className="p-5 space-y-5">

        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={cn('p-2 rounded-xl shrink-0 mt-0.5', def.badgeColor.replace('text-', 'text-').replace('bg-', 'bg-'))}>
              {def.icon}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[12px] font-black uppercase tracking-tight text-slate-900">{def.label}</p>
                {!def.hasSecondWindow && def.key === 'healthFormMissing' && (
                  <span className="text-[8px] font-black uppercase bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Always on</span>
                )}
              </div>
              <p className="text-[10px] font-bold text-muted-foreground mt-0.5">{def.description}</p>
              <div className="flex items-start gap-1.5 mt-1.5 p-2 rounded-lg bg-amber-50 border border-amber-100">
                <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[9px] font-black uppercase tracking-wider text-amber-700">{def.scheduleImpact}</p>
              </div>
            </div>
          </div>
          {!isLocked ? (
            <Switch
              checked={value.enabled}
              onCheckedChange={v => onChange({ ...value, enabled: v })}
              className="shrink-0 mt-1"
            />
          ) : (
            <div className="shrink-0 mt-1">
              <CheckCircle2 className="w-5 h-5 text-red-500" />
            </div>
          )}
        </div>

        {/* Config — only show when enabled */}
        {value.enabled && (
          <div className="space-y-4 pt-2 border-t border-dashed">

            {/* Severity */}
            <div className="space-y-2">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                Action severity
              </Label>
              <div className="grid gap-2">
                {SEVERITY_OPTIONS.filter(s =>
                  // Health form can only be warn or require, not auto-cancel
                  def.key === 'healthFormMissing' ? s.value !== 'auto_cancel' : true
                ).map(s => (
                  <button
                    key={s.value}
                    onClick={() => onChange({ ...value, severity: s.value })}
                    className={cn(
                      'w-full text-left p-3 rounded-xl border-2 transition-all',
                      value.severity === s.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border/50 hover:border-primary/30 bg-white'
                    )}
                  >
                    <p className={cn('text-[10px] font-black uppercase tracking-widest', value.severity === s.value ? 'text-primary' : 'text-slate-700')}>
                      {s.label}
                    </p>
                    <p className="text-[9px] font-bold text-muted-foreground mt-0.5">{s.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Windows */}
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  First reminder
                </Label>
                <Select
                  value={String(value.firstWindowHours)}
                  onValueChange={v => onChange({ ...value, firstWindowHours: Number(v) })}
                >
                  <SelectTrigger className="h-10 rounded-xl border-2 font-bold text-[10px] uppercase tracking-widest">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-2">
                    {WINDOW_OPTIONS.map(w => (
                      <SelectItem key={w.value} value={String(w.value)} className="font-bold text-[10px] uppercase">
                        {w.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {def.hasSecondWindow && (
                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                    {def.secondWindowLabel || 'Escalation / action'}
                  </Label>
                  <Select
                    value={String(value.secondWindowHours ?? 24)}
                    onValueChange={v => onChange({ ...value, secondWindowHours: Number(v) })}
                  >
                    <SelectTrigger className="h-10 rounded-xl border-2 font-bold text-[10px] uppercase tracking-widest">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-2">
                      {WINDOW_OPTIONS.map(w => (
                        <SelectItem key={w.value} value={String(w.value)} className="font-bold text-[10px] uppercase">
                          {w.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AutomationsSettingsPage() {
  const { firestore }      = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId           = selectedTenant?.id;
  const { toast }          = useToast();
  const [isSaving, setIsSaving]   = useState(false);
  const [automations, setAutomations] = useState<AppointmentAutomations>(DEFAULT_AUTOMATIONS);
  const [isDirty, setIsDirty]     = useState(false);

  // Load from tenant doc
  useEffect(() => {
    const saved = (selectedTenant as any)?.appointmentAutomations;
    if (saved) {
      setAutomations({ ...DEFAULT_AUTOMATIONS, ...saved });
    }
  }, [selectedTenant]);

  const handleChange = (key: keyof AppointmentAutomations, value: AutomationTrigger) => {
    setAutomations(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const handleSave = async () => {
    if (!firestore || !tenantId) return;
    setIsSaving(true);
    try {
      await setDoc(
        doc(firestore, 'tenants', tenantId),
        { appointmentAutomations: automations },
        { merge: true }
      );
      setIsDirty(false);
      toast({ title: 'Automations saved', description: 'Rules will apply to all upcoming appointments.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Save failed', description: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SettingsPage title="Automations" help="Everything the app does on its own. Switch each one on or off here — the words they use are on the Messages page.">
      <div className="space-y-10">
        {tenantId && <AutomationsOverview tenantId={tenantId} firestore={firestore as any} />}


        {/* Trigger cards */}
        <section id="followups" className="scroll-mt-8 space-y-4">
          <div className="space-y-1"><h2 className="text-[19px] font-semibold tracking-tight">Deposit and form reminders</h2>
            <p className="text-[14.5px] cf-muted">For appointments that still need a deposit or forms. Checked every hour; you’re told about everything it does.</p></div>
          <div className="space-y-4">
            {TRIGGER_DEFS.map(def => (
              <TriggerCard
                key={def.key}
                def={def}
                value={automations[def.key]}
                onChange={v => handleChange(def.key, v)}
              />
            ))}
          </div>
        </section>

        {/* Save footer */}
        {isDirty && (
          <div className="sticky bottom-4 flex justify-end">
            <button type="button" onClick={handleSave} disabled={isSaving} className="inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold shadow-lg disabled:opacity-60" style={{ background: 'var(--accent)', color: 'hsl(var(--primary-foreground))' }}>
              {isSaving ? <><Loader className="h-4 w-4 animate-spin" /> Saving…</> : 'Save these reminders'}
            </button>
          </div>
        )}
      </div>
    </SettingsPage>
  );
}
