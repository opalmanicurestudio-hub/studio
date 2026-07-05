'use client';

/**
 * TimezoneSettingCard — v1
 *
 * Sets the `timezone` field on the tenant doc — the field the AI
 * receptionist routes (and any future server-side scheduling logic) use to
 * compute business hours and speak appointment times correctly. Without it,
 * the server defaults to America/New_York, which is right for Opal but
 * wrong for any tenant outside Eastern time — so this belongs on the
 * settings page and in tenant onboarding.
 *
 * Self-contained: give it firestore, tenantId, and the current tenant doc
 * (for the initial value); it writes { timezone } back with merge. Shows a
 * live clock in the selected zone so the person configuring it can verify
 * at a glance ("does that say the time on your wall right now?").
 *
 * Client-side code (QuickBookForm etc.) is unaffected — it runs in the
 * browser and is already implicitly in the salon's local time. This field
 * is for code that runs on servers in UTC.
 *
 * Usage on the settings page:
 *   <TimezoneSettingCard firestore={firestore} tenantId={tenantId} tenant={tenant} />
 */

import React from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Globe, CheckCircle2, Loader, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const US_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (Phoenix — no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  { value: 'America/Puerto_Rico', label: 'Atlantic (Puerto Rico)' },
] as const;

const DEFAULT_TIMEZONE = 'America/New_York';

function nowIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date());
  } catch {
    return '';
  }
}

export function TimezoneSettingCard({
  firestore,
  tenantId,
  tenant,
  className,
}: {
  firestore: any;
  tenantId: string;
  tenant: any;
  className?: string;
}) {
  const { toast } = useToast();
  const savedValue: string = tenant?.timezone || '';
  const [selected, setSelected] = React.useState<string>(
    savedValue || DEFAULT_TIMEZONE,
  );
  const [isSaving, setIsSaving] = React.useState(false);
  const [preview, setPreview] = React.useState(() => nowIn(savedValue || DEFAULT_TIMEZONE));

  // Keep local state in sync if the tenant doc changes underneath us
  React.useEffect(() => {
    if (tenant?.timezone) setSelected(tenant.timezone);
  }, [tenant?.timezone]);

  // Live clock preview, ticking every 30s
  React.useEffect(() => {
    setPreview(nowIn(selected));
    const interval = setInterval(() => setPreview(nowIn(selected)), 30_000);
    return () => clearInterval(interval);
  }, [selected]);

  const isDirty = selected !== savedValue;
  const isUnset = !savedValue;

  const handleSave = async () => {
    if (!firestore || !tenantId) return;
    setIsSaving(true);
    try {
      await setDoc(
        doc(firestore, 'tenants', tenantId),
        { timezone: selected },
        { merge: true },
      );
      toast({ title: 'Timezone saved', description: `Studio time set to ${US_TIMEZONES.find(t => t.value === selected)?.label || selected}.` });
    } catch {
      toast({ variant: 'destructive', title: 'Could not save timezone' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={cn('rounded-2xl border bg-white overflow-hidden shadow-sm', className)}>
      <div className="p-4 border-b flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
          <Globe className="w-4 h-4 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">Studio timezone</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Used by the AI receptionist and automations to compute business
            hours and speak appointment times correctly.
          </p>
        </div>
        {isUnset && (
          <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full shrink-0">
            Not set — using Eastern
          </span>
        )}
      </div>

      <div className="p-4 space-y-3">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full h-10 rounded-lg border text-xs px-3 bg-white"
        >
          {US_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>

        <div className="rounded-lg bg-slate-50 border px-3 py-2 flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <p className="text-xs text-slate-600">
            Right now in this zone it's{' '}
            <span className="font-medium text-slate-900">{preview}</span>
            <span className="text-slate-400"> — should match the clock on your wall.</span>
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          {!isDirty && savedValue ? (
            <p className="text-[11px] text-green-600 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Saved
            </p>
          ) : (
            <span />
          )}
          <Button
            size="sm"
            className="h-9 text-xs"
            onClick={handleSave}
            disabled={isSaving || (!isDirty && !!savedValue)}
          >
            {isSaving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : 'Save timezone'}
          </Button>
        </div>
      </div>
    </div>
  );
}
