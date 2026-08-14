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

import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
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
  MapPin, Plus, Pencil, Building, AlertCircle, Target, CheckCircle2, Loader, Clock,
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

        {locations.map((loc) => (
          <div
            key={loc.id}
            className="p-5 rounded-[2rem] border-2 bg-slate-50 border-slate-200 flex flex-col sm:flex-row items-start justify-between gap-4"
          >
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-black uppercase tracking-tight text-slate-900">{loc.name}</p>
                {!loc.isActive && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
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
            </div>
          </div>
        ))}

        <Button onClick={openCreate} className="w-full sm:w-auto h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest">
          <Plus className="h-4 w-4 mr-2" />
          Add location
        </Button>
      </CardContent>

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
