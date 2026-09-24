'use client';

/**
 * components/settings/LocationsSettingsTab.tsx
 *
 * Every physical place this business operates, and — new — WHERE each one
 * actually is.
 *
 * WHY THE ADDRESS FIELDS CHANGED. This held one free-text line. That is
 * enough to print on a page and not enough for anything else: a geocoder
 * wants the street apart from the city, a shipping label wants a postal code
 * in its own field, and a tax jurisdiction is decided by state and ZIP. You
 * cannot split "123 Main St Springfield NC 27401" back into those reliably —
 * every attempt is a guess that fails on the addresses that matter. So the
 * parts are stored as parts, and the display line is DERIVED from them by
 * formatLocationAddress(), which means the line printed on a page and the
 * fields a label reads can never drift apart.
 *
 * WHY COORDINATES ARE HERE. An address is not a position. A geofence measures
 * distance, so it needs a point, and that point has to be resolved once and
 * stored — not looked up on every clock-in, which would put a staff member's
 * shift at the mercy of a third-party API being up. Locate Address geocodes
 * the fields; Use My Location takes GPS and fills the fields back in. Same
 * two paths, same provider, as the studio-wide card in Settings.
 *
 * WHAT READS THIS TODAY: the per-location `timezone` (rent due dates, and now
 * every date the app derives). The coordinates and radii are STORED but not
 * yet read — the timeclock still measures against the tenant-wide
 * `studioLocation`, and curbside pickup against `retailSettings.curbside*`.
 * Wiring those to prefer this location's own values is a separate, deliberate
 * change, because it moves where two live geofences get their truth.
 */

import { useState, useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useLocation } from '@/context/LocationContext';
import { createLocation } from '@/lib/booth-rental-service';
import { Location, LocationAddressParts, formatLocationAddress } from '@/lib/booth-rental-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  MapPin, Plus, Pencil, Building, AlertCircle, Target, CheckCircle2, Loader, Clock, Trash2,
} from 'lucide-react';

// A modest, common-case list — not exhaustive. Free-text would risk typos in
// a field the daily billing job actually depends on; a curated Select is
// safer than either extreme.
const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'UTC',
];

// Matches the tenant-wide geofence defaults in Settings, so a location that
// says nothing behaves exactly as the studio always has.
const DEFAULT_RADIUS_M = 200;
const DEFAULT_BREAK_RADIUS_M = 500;

const FIELD = 'h-12 rounded-2xl border-2 font-bold bg-white focus:border-primary/50';
const FIELD_LABEL = 'text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1';

const SectionHeader = ({ icon: Icon, title }: { icon: any; title: string }) => (
  <div className="flex items-center gap-3 mb-6 text-left">
    <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
      <Icon className="w-4 h-4" />
    </div>
    <div className="space-y-0.5 text-left">
      <p className="text-[8px] font-black uppercase tracking-widest text-primary/60">Module Operational</p>
      <h3 className="text-sm md:text-base font-black uppercase tracking-tighter text-slate-900">{title}</h3>
    </div>
  </div>
);

/** A titled block inside the dialog — same shape as the panels on the
 *  Settings page, so the dialog reads as part of the app rather than as a
 *  stock component that wandered in. */
const Panel = ({ icon: Icon, title, hint, children }: {
  icon: any; title: string; hint?: string; children: React.ReactNode;
}) => (
  <div className="p-5 rounded-[2rem] border-2 bg-slate-50 border-slate-200 space-y-4">
    <div className="flex items-start gap-3">
      <div className="p-2.5 rounded-xl bg-white border-2 shadow-sm shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="space-y-1 min-w-0">
        <p className="text-sm font-black uppercase tracking-tight text-slate-900">{title}</p>
        {hint && (
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 leading-relaxed">{hint}</p>
        )}
      </div>
    </div>
    {children}
  </div>
);

interface LocationFormState {
  name: string;
  street: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  timezone: string;
  lat: string;
  lng: string;
  radius: string;
  breakRadius: string;
}

const EMPTY_FORM: LocationFormState = {
  name: '', street: '', street2: '', city: '', state: '', zip: '', country: '',
  timezone: 'America/New_York',
  lat: '', lng: '', radius: '', breakRadius: '',
};

export function LocationsSettingsTab() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;

  const { locations, isLoading, selectedLocationId, setSelectedLocationId } = useLocation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LocationFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = (patch: Partial<LocationFormState>) => setForm((p) => ({ ...p, ...patch }));

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setNotice(null);
    setDialogOpen(true);
  };

  const openEdit = (loc: Location) => {
    const p = loc.addressParts;
    setEditingId(loc.id);
    setForm({
      name: loc.name,
      // A location saved before this screen existed has only the display
      // line. Keeping it in `street` rather than throwing it away means the
      // owner sees what they typed and can split it themselves, once.
      street: p?.street ?? (loc.address ?? ''),
      street2: p?.street2 ?? '',
      city: p?.city ?? '',
      state: p?.state ?? '',
      zip: p?.zip ?? '',
      country: p?.country ?? '',
      timezone: loc.timezone,
      lat: loc.coordinates ? String(loc.coordinates.lat) : '',
      lng: loc.coordinates ? String(loc.coordinates.lng) : '',
      radius: Number.isFinite(loc.geoFenceRadiusMeters) ? String(loc.geoFenceRadiusMeters) : '',
      breakRadius: Number.isFinite(loc.geoFenceBreakRadiusMeters) ? String(loc.geoFenceBreakRadiusMeters) : '',
    });
    setError(null);
    setNotice(null);
    setDialogOpen(true);
  };

  const partsOf = (f: LocationFormState): LocationAddressParts | undefined => {
    const has = [f.street, f.city, f.state, f.zip].some((v) => v.trim());
    if (!has) return undefined;
    const parts: LocationAddressParts = {
      street: f.street.trim(),
      city: f.city.trim(),
      state: f.state.trim(),
      zip: f.zip.trim(),
    };
    if (f.street2.trim()) parts.street2 = f.street2.trim();
    if (f.country.trim()) parts.country = f.country.trim();
    return parts;
  };

  /** Address to point. Same provider as the studio-wide card, so the two
   *  screens can never disagree about where an address is. */
  const locateAddress = async () => {
    const q = [form.street, form.city, form.state, form.zip, form.country].filter((v) => v.trim());
    if (q.length < 2) {
      setError('Enter at least a street and a city before locating.');
      return;
    }
    setLocating(true); setError(null); setNotice(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q.join(', '))}&format=json&limit=1&addressdetails=1`
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        set({ lat: String(parseFloat(data[0].lat)), lng: String(parseFloat(data[0].lon)) });
        setNotice(data[0].display_name || 'Address located.');
      } else {
        setError('That address could not be found. Add more detail, or use GPS while standing at the door.');
      }
    } catch {
      setError('Address lookup is unreachable right now — you can still save without a pin and add it later.');
    } finally {
      setLocating(false);
    }
  };

  /** Point to address. Standing at the door is the most accurate way to set a
   *  geofence centre, so this fills the fields FROM the position rather than
   *  quietly storing coordinates that disagree with the typed address. */
  const useMyLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('This device cannot share its location.');
      return;
    }
    setLocating(true); setError(null); setNotice(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        set({ lat: String(latitude), lng: String(longitude) });
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
          );
          const data = await res.json();
          const a = data.address || {};
          set({
            street: [a.house_number, a.road].filter(Boolean).join(' ') || form.street,
            city: a.city || a.town || a.village || a.suburb || form.city,
            state: a.state || form.state,
            zip: a.postcode || form.zip,
          });
          setNotice(data.display_name || 'Position captured.');
        } catch {
          // The pin is the part that matters; the address is a convenience.
          setNotice(`Position captured: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        setError(err.code === 1
          ? 'Location access was denied — allow it in your browser, or type the address instead.'
          : 'Could not get a position. Type the address and use Locate Address.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const numOrUndef = (v: string) => {
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) ? n : undefined;
  };

  const handleSave = async () => {
    if (!form.name.trim() || !tenantId) return;
    const lat = numOrUndef(form.lat);
    const lng = numOrUndef(form.lng);
    // A half-set pin is worse than none: it would put a geofence in the
    // Atlantic and refuse every clock-in without saying why.
    if ((lat === undefined) !== (lng === undefined)) {
      setError('A pin needs both latitude and longitude. Use Locate Address, or clear both.');
      return;
    }
    if (lat !== undefined && (Math.abs(lat) > 90 || Math.abs(lng as number) > 180)) {
      setError('Those coordinates are out of range — latitude is -90 to 90, longitude -180 to 180.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const parts = partsOf(form);
      const display = formatLocationAddress(parts);
      const coordinates = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
      const radius = numOrUndef(form.radius);
      const breakRadius = numOrUndef(form.breakRadius);

      if (editingId) {
        // updateDoc accepts null to clear a field; createLocation cannot use
        // null because the type says the field is absent, not empty. Hence
        // the two shapes.
        await updateDoc(doc(firestore, 'tenants', tenantId, 'locations', editingId), {
          name: form.name.trim(),
          address: display || null,
          addressParts: parts ?? null,
          coordinates: coordinates ?? null,
          geoFenceRadiusMeters: radius ?? null,
          geoFenceBreakRadiusMeters: breakRadius ?? null,
          timezone: form.timezone,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await createLocation(firestore, {
          tenantId,
          name: form.name.trim(),
          address: display || undefined,
          addressParts: parts,
          coordinates,
          geoFenceRadiusMeters: radius,
          geoFenceBreakRadiusMeters: breakRadius,
          timezone: form.timezone,
        });
      }
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete — only when nothing points at the location ──
  // The server checks what references it (booths, renters, leases, station
  // bookings, appointments, maintenance, rent ledger, staff access) and
  // refuses if anything does, or if it's the last location. The dialog shows
  // the answer first; the delete only runs after that.
  const [delTarget, setDelTarget] = useState<Location | null>(null);
  const [delCheck, setDelCheck] = useState<{ canDelete: boolean; reason: string | null; refs: { label: string; count: number }[] } | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState('');
  const callDelete = async (locationId: string, mode: 'check' | 'delete') => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : null; if (tk) headers.Authorization = `Bearer ${tk}`; } catch { /* 401 explains */ }
    const res = await fetch('/api/locations/delete', { method: 'POST', headers, body: JSON.stringify({ tenantId, locationId, mode }) });
    return res.json().catch(() => ({ ok: false, error: 'No response' }));
  };
  const openDelete = async (loc: Location) => {
    setDelTarget(loc); setDelCheck(null); setDelError(''); setDelBusy(true);
    const d = await callDelete(loc.id, 'check');
    setDelBusy(false);
    if (d?.ok) setDelCheck({ canDelete: !!d.canDelete, reason: d.reason || null, refs: d.refs || [] });
    else setDelError(d?.error || 'Could not check that location.');
  };
  const confirmDelete = async () => {
    if (!delTarget) return;
    setDelBusy(true); setDelError('');
    const d = await callDelete(delTarget.id, 'delete');
    setDelBusy(false);
    if (d?.ok) {
      if (selectedLocationId === delTarget.id) { const next = locations.find((l) => l.id !== delTarget.id && l.isActive) || locations.find((l) => l.id !== delTarget.id); if (next) setSelectedLocationId(next.id); }
      setDelTarget(null);
    } else setDelError(d?.error || 'Could not delete it.');
  };

  // ── Leftover duplicates from the old provisioner ──
  const [dupes, setDupes] = useState<{ removableIds: string[]; inUseDuplicates: { id: string; name: string; refs: { label: string; count: number }[] }[]; keepId: string | null } | null>(null);
  const [dupBusy, setDupBusy] = useState(false);
  const [dupDone, setDupDone] = useState('');
  const scanDupes = async () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : null; if (tk) headers.Authorization = `Bearer ${tk}`; } catch { /* ignore */ }
    const res = await fetch('/api/locations/delete', { method: 'POST', headers, body: JSON.stringify({ tenantId, mode: 'duplicates' }) });
    const d = await res.json().catch(() => null);
    if (d?.ok) setDupes({ removableIds: d.removableIds || [], inUseDuplicates: d.inUseDuplicates || [], keepId: d.keepId || null });
  };
  useEffect(() => { if (tenantId) void scanDupes(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId, locations.length]);
  const cleanupDupes = async () => {
    setDupBusy(true);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : null; if (tk) headers.Authorization = `Bearer ${tk}`; } catch { /* ignore */ }
    const res = await fetch('/api/locations/delete', { method: 'POST', headers, body: JSON.stringify({ tenantId, mode: 'cleanup' }) });
    const d = await res.json().catch(() => null);
    setDupBusy(false);
    if (d?.ok) { setDupDone(`Removed ${d.removed} unused duplicate${d.removed === 1 ? '' : 's'}.`); if (dupes?.removableIds.includes(selectedLocationId || '') && dupes.keepId) setSelectedLocationId(dupes.keepId); void scanDupes(); }
  };

  // ── Multi-select ──
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCheck, setBulkCheck] = useState<{ results: any[]; deletable: number; blocked: number } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const runMerge = async () => {
    if (!mergeTarget) { setBulkMsg('Pick the location to keep.'); return; }
    const keep = locations.find((l) => l.id === mergeTarget);
    if (!window.confirm(`Merge ${picked.size} location${picked.size === 1 ? '' : 's'} into "${keep?.name || 'the one you picked'}"?\n\nEverything recorded against them — appointments, booths, renters, leases, staff access — moves to "${keep?.name}", then they're deleted. This can't be undone.`)) return;
    setBulkBusy(true); setBulkMsg('');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : null; if (tk) headers.Authorization = `Bearer ${tk}`; } catch { /* 401 explains */ }
    const res = await fetch('/api/locations/delete', { method: 'POST', headers, body: JSON.stringify({ tenantId, mode: 'merge', locationIds: [...picked], targetId: mergeTarget }) });
    const d = await res.json().catch(() => null);
    setBulkBusy(false);
    if (!d?.ok) { setBulkMsg(d?.error || 'Could not merge.'); return; }
    if (selectedLocationId && picked.has(selectedLocationId)) setSelectedLocationId(mergeTarget);
    const movedTotal = Object.values(d.moved || {}).reduce((n: number, x: any) => n + Number(x || 0), 0);
    setPicked(new Set()); setBulkOpen(false); setMergeTarget('');
    setDupDone(`Merged ${d.merged} location${d.merged === 1 ? '' : 's'} into ${keep?.name || 'your location'} — ${movedTotal} record${movedTotal === 1 ? '' : 's'} moved across.`);
  };
  const togglePick = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPicked = locations.length > 0 && locations.every((l) => picked.has(l.id));
  const callBulk = async (mode: 'bulk-check' | 'bulk-delete') => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : null; if (tk) headers.Authorization = `Bearer ${tk}`; } catch { /* 401 explains */ }
    const res = await fetch('/api/locations/delete', { method: 'POST', headers, body: JSON.stringify({ tenantId, mode, locationIds: [...picked] }) });
    return res.json().catch(() => ({ ok: false, error: 'No response' }));
  };
  const openBulk = async () => {
    setBulkOpen(true); setBulkCheck(null); setBulkMsg(''); setBulkBusy(true);
    const d = await callBulk('bulk-check');
    setBulkBusy(false);
    if (d?.ok) setBulkCheck({ results: d.results || [], deletable: d.deletable || 0, blocked: d.blocked || 0 });
    else setBulkMsg(d?.error || 'Could not check those locations.');
  };
  const runBulk = async () => {
    setBulkBusy(true); setBulkMsg('');
    const d = await callBulk('bulk-delete');
    setBulkBusy(false);
    if (!d?.ok) { setBulkMsg(d?.error || 'Could not delete.'); return; }
    const gone = new Set<string>(d.deleted || []);
    if (selectedLocationId && gone.has(selectedLocationId)) { const next = locations.find((l) => !gone.has(l.id) && l.isActive) || locations.find((l) => !gone.has(l.id)); if (next) setSelectedLocationId(next.id); }
    setPicked(new Set()); setBulkOpen(false);
    setDupDone(`Deleted ${gone.size} location${gone.size === 1 ? '' : 's'}.`);
  };
  const deactivateBlocked = async () => {
    if (!bulkCheck) return;
    setBulkBusy(true);
    for (const r of bulkCheck.results) if (!r.canDelete && r.isActive && r.refs?.length) { const loc = locations.find((l) => l.id === r.id); if (loc && loc.isActive) await toggleActive(loc); }
    setBulkBusy(false); setBulkOpen(false); setPicked(new Set());
    setDupDone('The locations still in use were set to Inactive — they stop taking bookings and keep their history.');
  };

  const toggleActive = async (loc: Location) => {
    if (!tenantId) return;
    await updateDoc(doc(firestore, 'tenants', tenantId, 'locations', loc.id), {
      isActive: !loc.isActive,
      updatedAt: new Date().toISOString(),
    });
  };

  const pinned = form.lat.trim() !== '' && form.lng.trim() !== '';

  return (
    <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
      <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
        <SectionHeader icon={MapPin} title="Locations" />
        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
          Every physical studio this business operates. Staff can be restricted
          to specific locations under Staff settings.
        </CardDescription>
      </CardHeader>

      <CardContent className="p-6 md:p-8 space-y-4 text-left">
        {isLoading && <p className="text-sm text-muted-foreground">Loading locations…</p>}
        {dupDone && <p className="rounded-xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">{dupDone}</p>}
        {dupes && dupes.removableIds.length > 0 && (
          <div className="rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
            <p className="text-sm font-bold text-amber-900">
              {dupes.removableIds.length} duplicate “Main Location” {dupes.removableIds.length === 1 ? 'entry was' : 'entries were'} created automatically by an older version of the app — you didn’t make {dupes.removableIds.length === 1 ? 'it' : 'them'}, and nothing uses {dupes.removableIds.length === 1 ? 'it' : 'them'}.
            </p>
            <Button size="sm" disabled={dupBusy} onClick={cleanupDupes}>{dupBusy ? 'Removing…' : `Remove ${dupes.removableIds.length} unused duplicate${dupes.removableIds.length === 1 ? '' : 's'}`}</Button>
          </div>
        )}
        {dupes && dupes.inUseDuplicates.length > 0 && (
          <div className="rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 space-y-1">
            <p className="text-sm font-bold text-slate-800">Also auto-created, but in use — left alone:</p>
            {dupes.inUseDuplicates.map((d) => <p key={d.id} className="text-xs text-slate-600"><span className="font-bold">{d.name}</span> · {d.refs.map((r) => `${r.count} ${r.label}`).join(', ')}. Move those to your main location, then delete it.</p>)}
          </div>
        )}

        {!isLoading && locations.length === 0 && (
          <div className="p-8 text-center space-y-3 rounded-[2rem] border-2 border-dashed border-slate-200">
            <Building className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium">No locations yet</p>
            <p className="text-xs text-muted-foreground">
              Add your first one — this is what every booth, renter, and lease
              will be scoped to.
            </p>
          </div>
        )}

        {locations.length > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 bg-white px-4 py-2.5">
            <label className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-600 cursor-pointer">
              <input type="checkbox" className="h-4 w-4" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(locations.map((l) => l.id)))} />
              {picked.size ? `${picked.size} selected` : 'Select'}
            </label>
            {picked.size > 0 && (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>Clear</Button>
                <Button variant="destructive" size="sm" onClick={openBulk}><Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete selected ({picked.size})</Button>
              </div>
            )}
          </div>
        )}
        {locations.map((loc) => (
          <div
            key={loc.id}
            className={`p-5 rounded-[2rem] border-2 flex flex-col sm:flex-row items-start justify-between gap-4 ${picked.has(loc.id) ? 'bg-red-50/40 border-red-200' : 'bg-slate-50 border-slate-200'}`}
          >
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                {locations.length > 1 && <input type="checkbox" aria-label={`Select ${loc.name}`} className="h-4 w-4" checked={picked.has(loc.id)} onChange={() => togglePick(loc.id)} />}
                <p className="text-sm font-black uppercase tracking-tight text-slate-900">{loc.name}</p>
                {!loc.isActive && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                {(loc as any).createdAt && <span className="text-[10px] font-bold text-slate-400">added {new Date((loc as any).createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                {loc.id === selectedLocationId && <Badge className="text-[10px]">Currently viewing</Badge>}
              </div>

              {(loc.address || loc.addressParts) && (
                <p className="text-xs text-muted-foreground">
                  {formatLocationAddress(loc.addressParts) || loc.address}
                </p>
              )}

              <div className="flex items-center gap-3 flex-wrap pt-0.5">
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest opacity-60">
                  {loc.timezone}
                </span>
                {loc.coordinates ? (
                  <a
                    href={`https://www.google.com/maps?q=${loc.coordinates.lat},${loc.coordinates.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-green-700 underline underline-offset-2 hover:text-green-900"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Pinned — verify on maps
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-amber-600">
                    <AlertCircle className="w-3 h-3" /> No pin set
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 items-start sm:items-end shrink-0">
              <Button variant="outline" size="sm" onClick={() => openEdit(loc)}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
              {loc.id !== selectedLocationId && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedLocationId(loc.id)}>
                  Switch to this
                </Button>
              )}
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold uppercase text-muted-foreground">
                  {loc.isActive ? 'Active' : 'Inactive'}
                </span>
                <Switch checked={loc.isActive} onCheckedChange={() => toggleActive(loc)} />
              </div>
              <Button variant="ghost" size="sm" onClick={() => openDelete(loc)} className="text-muted-foreground hover:text-red-700">
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Delete
              </Button>
            </div>
          </div>
        ))}

        <Button onClick={openCreate} className="w-full sm:w-auto h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest">
          <Plus className="h-4 w-4 mr-2" />
          Add location
        </Button>
      </CardContent>

      <Dialog open={bulkOpen} onOpenChange={(o) => { if (!o) setBulkOpen(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete {picked.size} location{picked.size === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>
              {bulkBusy && !bulkCheck ? 'Checking what uses each one…'
                : bulkCheck ? (bulkCheck.deletable === 0 ? 'None of these can be deleted — see why below.'
                  : `${bulkCheck.deletable} can be deleted cleanly${bulkCheck.blocked ? `; ${bulkCheck.blocked} can’t and will be left alone` : ''}. This can’t be undone.`) : ''}
            </DialogDescription>
          </DialogHeader>
          {bulkCheck && (
            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
              {bulkCheck.results.map((r) => (
                <div key={r.id} className={`rounded-xl border px-3 py-2 text-sm ${r.canDelete ? 'border-red-200 bg-red-50/50' : 'border-slate-200 bg-slate-50'}`}>
                  <p className="font-bold">{r.canDelete ? '✕ ' : '— '}{r.name}</p>
                  <p className="text-xs text-muted-foreground">{r.canDelete ? 'Nothing uses it — will be deleted.' : r.reason}</p>
                </div>
              ))}
            </div>
          )}
          {bulkCheck && bulkCheck.results.some((r) => !r.canDelete && r.refs?.length) && (
            <div className="space-y-2 rounded-xl border-2 border-sky-200 bg-sky-50 p-3">
              <p className="text-sm font-bold text-sky-900">Duplicates that are in use can be merged instead: everything recorded against them moves to the location you keep, then they’re deleted.</p>
              <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} aria-label="Location to keep" className="h-10 w-full rounded-lg border-2 bg-white px-2 text-sm font-bold">
                <option value="">Keep which location?</option>
                {locations.filter((l) => !picked.has(l.id)).map((l) => <option key={l.id} value={l.id}>{l.name}{l.isActive ? '' : ' (inactive)'}</option>)}
              </select>
              {locations.filter((l) => !picked.has(l.id)).length === 0 && <p className="text-xs font-bold text-sky-900">Untick the one you want to keep first — you’ve selected every location.</p>}
            </div>
          )}
          {bulkMsg && <p className="text-sm font-bold text-red-700">{bulkMsg}</p>}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            {bulkCheck && bulkCheck.results.some((r) => !r.canDelete && r.isActive && r.refs?.length) && (
              <Button variant="secondary" disabled={bulkBusy} onClick={deactivateBlocked}>Set the in-use ones inactive</Button>
            )}
            {bulkCheck && bulkCheck.results.some((r) => !r.canDelete && r.refs?.length) && (
              <Button disabled={bulkBusy || !mergeTarget} onClick={runMerge}>{bulkBusy ? 'Merging…' : `Merge ${picked.size} & delete`}</Button>
            )}
            {bulkCheck && bulkCheck.deletable > 0 && (
              <Button variant="destructive" disabled={bulkBusy} onClick={runBulk}>{bulkBusy ? 'Deleting…' : `Delete ${bulkCheck.deletable}`}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!delTarget} onOpenChange={(o) => { if (!o) setDelTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {delTarget?.name || 'this location'}?</DialogTitle>
            <DialogDescription>
              {delBusy && !delCheck ? 'Checking what uses this location…'
                : delCheck?.canDelete ? 'Nothing in the app points at this location, so it can be deleted cleanly. This can’t be undone.'
                : delCheck ? (delCheck.reason || 'This location is still in use.') : ''}
            </DialogDescription>
          </DialogHeader>
          {delCheck && !delCheck.canDelete && delCheck.refs.length > 0 && (
            <ul className="space-y-1 rounded-xl border bg-muted/20 p-3 text-sm">
              {delCheck.refs.map((r) => <li key={r.label}><span className="font-black">{r.count}</span> {r.label}</li>)}
            </ul>
          )}
          {delCheck && !delCheck.canDelete && (
            <p className="text-xs text-muted-foreground">Deleting would leave these pointing at nothing. Set it to <span className="font-bold">Inactive</span> instead — it stops taking bookings and staff can’t clock in there, and all its history stays intact. To delete it later, move its booths, renters and leases to another location first.</p>
          )}
          {delError && <p className="text-sm font-bold text-red-700">{delError}</p>}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDelTarget(null)}>Cancel</Button>
            {delCheck && !delCheck.canDelete && delTarget?.isActive && (
              <Button variant="secondary" onClick={async () => { if (delTarget) await toggleActive(delTarget); setDelTarget(null); }}>Set inactive</Button>
            )}
            {delCheck?.canDelete && (
              <Button variant="destructive" disabled={delBusy} onClick={confirmDelete}>{delBusy ? 'Deleting…' : 'Delete location'}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto rounded-[2.5rem] border-2 p-6 md:p-8">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base font-black uppercase tracking-tighter text-slate-900">
              {editingId ? 'Edit location' : 'Add location'}
            </DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">
              {editingId
                ? 'Where this studio is, and how far from it counts as being there.'
                : 'Every booth, renter, and lease will belong to a location.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <Panel icon={Building} title="Identity" hint="What you call this place, and which clock it runs on">
              <div className="space-y-1.5">
                <Label htmlFor="loc-name" className={FIELD_LABEL}>Location name</Label>
                <Input
                  id="loc-name"
                  placeholder="Downtown, Westside, Main Location…"
                  value={form.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ name: e.target.value })}
                  className={FIELD}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={FIELD_LABEL}>Timezone</Label>
                <Select value={form.timezone} onValueChange={(v: string) => set({ timezone: v })}>
                  <SelectTrigger className={FIELD}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COMMON_TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 ml-1 leading-relaxed">
                  Decides when rent is due at midnight here, and every other
                  date this location derives.
                </p>
              </div>
            </Panel>

            <Panel icon={MapPin} title="Address" hint="Kept in separate fields — labels, tax and maps all need the parts">
              <div className="space-y-1.5">
                <Label htmlFor="loc-street" className={FIELD_LABEL}>Street address</Label>
                <Input id="loc-street" placeholder="123 Main St" value={form.street}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ street: e.target.value })} className={FIELD} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loc-street2" className={FIELD_LABEL}>Suite / unit (optional)</Label>
                <Input id="loc-street2" placeholder="Suite 200" value={form.street2}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ street2: e.target.value })} className={FIELD} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="loc-city" className={FIELD_LABEL}>City</Label>
                  <Input id="loc-city" placeholder="Burlington" value={form.city}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ city: e.target.value })} className={FIELD} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loc-state" className={FIELD_LABEL}>State</Label>
                  <Input id="loc-state" placeholder="NC" value={form.state}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ state: e.target.value })} className={FIELD} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="loc-zip" className={FIELD_LABEL}>ZIP / postal code</Label>
                  <Input id="loc-zip" placeholder="27215" value={form.zip}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ zip: e.target.value })} className={FIELD} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loc-country" className={FIELD_LABEL}>Country (optional)</Label>
                  <Input id="loc-country" placeholder="United States" value={form.country}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ country: e.target.value })} className={FIELD} />
                </div>
              </div>
            </Panel>

            <Panel icon={Target} title="Map pin" hint="The point a geofence measures from — set it once, stored for good">
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  type="button"
                  onClick={locateAddress}
                  disabled={locating}
                  className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest"
                >
                  {locating ? <Loader className="animate-spin w-4 h-4" /> : <><MapPin className="w-4 h-4 mr-2" />Locate address</>}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={useMyLocation}
                  disabled={locating}
                  className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2 bg-white"
                >
                  {locating ? <Loader className="animate-spin w-4 h-4" /> : <><Target className="w-4 h-4 mr-2" />Use my location</>}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="loc-lat" className={FIELD_LABEL}>Latitude</Label>
                  <Input id="loc-lat" inputMode="decimal" placeholder="36.0956" value={form.lat}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ lat: e.target.value })} className={`${FIELD} font-mono`} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loc-lng" className={FIELD_LABEL}>Longitude</Label>
                  <Input id="loc-lng" inputMode="decimal" placeholder="-79.4378" value={form.lng}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ lng: e.target.value })} className={`${FIELD} font-mono`} />
                </div>
              </div>

              {pinned && (
                <a
                  href={`https://www.google.com/maps?q=${form.lat},${form.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-green-700 underline underline-offset-2 hover:text-green-900"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Verify this pin on Google Maps
                </a>
              )}
            </Panel>

            <Panel icon={Clock} title="Clock-in radius" hint="Leave blank to use the studio-wide setting">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="loc-radius" className={FIELD_LABEL}>Clock in (m)</Label>
                  <Input id="loc-radius" inputMode="numeric" placeholder={String(DEFAULT_RADIUS_M)} value={form.radius}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ radius: e.target.value })} className={FIELD} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loc-break" className={FIELD_LABEL}>Back from break (m)</Label>
                  <Input id="loc-break" inputMode="numeric" placeholder={String(DEFAULT_BREAK_RADIUS_M)} value={form.breakRadius}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ breakRadius: e.target.value })} className={FIELD} />
                </div>
              </div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-amber-600 ml-1 leading-relaxed">
                Stored here, not yet enforced — the timeclock still measures
                against the studio-wide pin in Settings.
              </p>
            </Panel>

            {notice && (
              <div className="flex items-start gap-2 rounded-2xl border-2 border-green-200 bg-green-50 px-4 py-3">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 mt-0.5" />
                <p className="text-[10px] font-bold text-green-800 leading-relaxed">{notice}</p>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-2xl border-2 border-destructive/40 bg-destructive/10 px-4 py-3">
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                <p className="text-[10px] font-bold text-destructive leading-relaxed">{error}</p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}
              className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}
              className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest">
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add location'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
