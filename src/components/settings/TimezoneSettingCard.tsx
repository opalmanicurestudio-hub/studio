'use client';
// src/components/settings/TimezoneSettingCard.tsx — THE BUSINESS'S TIME ZONE (tenant.timezone). Reminders, booking
// times, reports and the phone receptionist all run on it (lib/tenant-time). Sign-up saves the owner's own zone from
// their device, which can be anywhere, so the list always includes the zone that's saved and the one this device is in.
// Saving also moves the main location's zone along with it when that location was on the old zone (or never had one).
import React from 'react';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { Loader, Clock, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { isValidTimeZone } from '@/lib/tenant-time';

const US_ZONES: { value: string; label: string }[] = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (Phoenix, no daylight saving)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  { value: 'America/Puerto_Rico', label: 'Atlantic (Puerto Rico)' },
];
const OLD_DEFAULT = 'America/New_York';
const nameOf = (tz: string) => US_ZONES.find((z) => z.value === tz)?.label || tz.replace(/_/g, ' ').replace(/\//g, ' / ');

function nowIn(timeZone: string): string {
  try { return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date()); }
  catch { return ''; }
}
const deviceZone = () => { try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; return isValidTimeZone(z) ? z : ''; } catch { return ''; } };

export function TimezoneSettingCard({ firestore, tenantId, tenant, className }: { firestore: any; tenantId: string; tenant: any; className?: string }) {
  const { toast } = useToast();
  const saved: string = isValidTimeZone(tenant?.timezone) ? String(tenant.timezone) : '';
  const here = React.useMemo(deviceZone, []);
  const [selected, setSelected] = React.useState<string>(saved || here || OLD_DEFAULT);
  const [saving, setSaving] = React.useState(false);
  const [preview, setPreview] = React.useState(() => nowIn(saved || here || OLD_DEFAULT));

  React.useEffect(() => { if (saved) setSelected(saved); }, [saved]);
  React.useEffect(() => {
    setPreview(nowIn(selected));
    const t = setInterval(() => setPreview(nowIn(selected)), 30_000);
    return () => clearInterval(t);
  }, [selected]);

  // The saved zone and this device's zone are always choices, even when they aren't in the US list.
  const options = React.useMemo(() => {
    const extra = [saved, here, selected].filter((z, i, a) => z && isValidTimeZone(z) && a.indexOf(z) === i && !US_ZONES.some((u) => u.value === z));
    return [...extra.map((z) => ({ value: z, label: z === here ? `${nameOf(z)} (this device)` : nameOf(z) })), ...US_ZONES];
  }, [saved, here, selected]);

  const dirty = selected !== saved;

  const save = async () => {
    if (!firestore || !tenantId || !isValidTimeZone(selected)) return;
    setSaving(true);
    try {
      await setDoc(doc(firestore, 'tenants', tenantId), { timezone: selected }, { merge: true });
      // The main location follows when it was on the old zone, or never had one of its own.
      try {
        const lref = doc(firestore, `tenants/${tenantId}/locations/primary`);
        const l: any = (await getDoc(lref)).data();
        if (l && (!l.timezone || l.timezone === (saved || OLD_DEFAULT))) await setDoc(lref, { timezone: selected }, { merge: true });
      } catch { /* the business's own zone is saved; a location can be changed in Locations */ }
      toast({ title: 'Time zone saved', description: nameOf(selected) });
    } catch {
      toast({ variant: 'destructive', title: 'That didn’t save', description: 'Please try again.' });
    } finally { setSaving(false); }
  };

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label className="flex flex-col gap-1.5 text-[14px] font-medium">Time zone
        <select value={selected} onChange={(e) => setSelected(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-card px-3 text-[15px]">
          {options.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
        </select>
      </label>
      <p className="flex items-center gap-2 text-[13.5px] text-muted-foreground"><Clock className="h-4 w-4 shrink-0" aria-hidden /> It’s {preview} there now. That should match the clock where you are.</p>
      <div className="flex items-center justify-between gap-3">
        {!dirty && saved ? <span className="flex items-center gap-1 text-[13.5px]" style={{ color: 'var(--ok-ink)' }}><Check className="h-4 w-4" aria-hidden /> Saved</span> : <span />}
        <button type="button" onClick={save} disabled={saving || (!dirty && !!saved)} className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background disabled:opacity-50">
          {saving && <Loader className="h-4 w-4 animate-spin" aria-hidden />}Save time zone
        </button>
      </div>
    </div>
  );
}
