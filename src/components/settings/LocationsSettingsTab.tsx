'use client';

/**
 * components/settings/LocationsSettingsTab.tsx
 *
 * Drop-in tab for the Settings page. Fills the actual gap identified in
 * booth-rental-service.ts's own comment: "There was no create path
 * anywhere for Location documents until now" — this is that missing UI.
 *
 * INTEGRATION (3 small edits to your existing settings page.tsx):
 *
 * 1. Import this component and MapPin is already imported there:
 *      import { LocationsSettingsTab } from '@/components/settings/LocationsSettingsTab';
 *
 * 2. Add a tab entry to the existing `tabs` array (MapPin icon is already
 *    imported in that file, no new icon import needed):
 *      { value: 'locations', label: 'Locations', icon: <MapPin className="w-4 h-4" /> },
 *
 * 3. Add 'locations' to `selfManagedTabs` (this tab has its own
 *    dialog-based save flow, not the page's global isEditing/handleSave):
 *      const selfManagedTabs = ['terminal', 'automations', 'locations'];
 *
 * 4. Add the TabsContent block anywhere alongside the others:
 *      <TabsContent value="locations" className="mt-0 space-y-10 animate-in fade-in duration-500 text-left">
 *        <LocationsSettingsTab />
 *      </TabsContent>
 *
 * That's the whole integration — this component manages its own Firestore
 * reads/writes and doesn't need any props.
 */

import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useLocation } from '@/context/LocationContext';
import { createLocation } from '@/lib/booth-rental-service';
import { Location } from '@/lib/booth-rental-types';
import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardHeader, CardDescription,
} from '@/components/ui/card';
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
import { MapPin, Plus, Pencil, Building, AlertCircle } from 'lucide-react';

// A modest, common-case list — not exhaustive. Free-text would risk typos
// in a field the daily billing job actually depends on (see Location's
// own field comment on why timezone matters per-location); a curated
// Select is safer than either extreme.
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

interface LocationFormState {
  name: string;
  address: string;
  timezone: string;
}

const EMPTY_FORM: LocationFormState = {
  name: '',
  address: '',
  timezone: 'America/New_York',
};

export function LocationsSettingsTab() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;

  // Deliberately NOT scoped by locationId (there's nothing to scope
  // Locations themselves by) — this reads every Location for the tenant,
  // same list useLocation() itself resolves from.
  const { locations, isLoading, selectedLocationId, setSelectedLocationId } =
    useLocation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LocationFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (loc: Location) => {
    setEditingId(loc.id);
    setForm({
      name: loc.name,
      address: loc.address ?? '',
      timezone: loc.timezone,
    });
    setError(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !tenantId) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        // No updateLocation() exists in the service layer — matches its
        // own convention (single-doc, no-side-effect writes stay direct)
        // seen for booth/renter edits elsewhere in this codebase.
        await updateDoc(
          doc(firestore, 'tenants', tenantId, 'locations', editingId),
          {
            name: form.name.trim(),
            address: form.address.trim() || null,
            timezone: form.timezone,
            updatedAt: new Date().toISOString(),
          }
        );
      } else {
        await createLocation(firestore, {
          tenantId,
          name: form.name.trim(),
          address: form.address.trim() || undefined,
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

  return (
    <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
      <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
        <SectionHeader icon={MapPin} title="Locations" />
        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
          Every physical studio this business operates. Staff can be
          restricted to specific locations under Staff settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6 md:p-8 space-y-4 text-left">
        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading locations…</p>
        )}

        {!isLoading && locations.length === 0 && (
          <div className="p-8 text-center space-y-3 rounded-[2rem] border-2 border-dashed border-slate-200">
            <Building className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium">No locations yet</p>
            <p className="text-xs text-muted-foreground">
              Add your first one — this is what every booth, renter, and
              lease will be scoped to.
            </p>
          </div>
        )}

        {locations.map((loc) => (
          <div
            key={loc.id}
            className="p-5 rounded-[2rem] border-2 bg-slate-50 border-slate-200 flex items-start justify-between gap-4"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-black uppercase tracking-tight text-slate-900">
                  {loc.name}
                </p>
                {!loc.isActive && (
                  <Badge variant="secondary" className="text-[10px]">Inactive</Badge>
                )}
                {loc.id === selectedLocationId && (
                  <Badge className="text-[10px]">Currently viewing</Badge>
                )}
              </div>
              {loc.address && (
                <p className="text-xs text-muted-foreground">{loc.address}</p>
              )}
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest opacity-60">
                {loc.timezone}
              </p>
            </div>
            <div className="flex flex-col gap-2 items-end shrink-0">
              <Button variant="outline" size="sm" onClick={() => openEdit(loc)}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
              {loc.id !== selectedLocationId && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedLocationId(loc.id)}
                >
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

        <Button onClick={openCreate} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" />
          Add location
        </Button>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit location' : 'Add location'}</DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Update this location\'s details.'
                : 'Every booth, renter, and lease will belong to a location — this is the first one you\'ll assign them to.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="loc-name">Name</Label>
              <Input
                id="loc-name"
                placeholder="Downtown, Westside, Main Location…"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loc-address">Address (optional)</Label>
              <Input
                id="loc-address"
                placeholder="123 Main St, Springfield"
                value={form.address}
                onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Timezone</Label>
              <Select
                value={form.timezone}
                onValueChange={(v) => setForm((p) => ({ ...p, timezone: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Used to determine when rent is "due at midnight" for this
                location's leases.
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add location'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
