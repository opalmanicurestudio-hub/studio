'use client';

/**
 * components/shared/LocationSwitcher.tsx
 *
 * Small reusable dropdown wired to the real LocationContext (setSelectedLocationId
 * confirmed from the actual LocationContext.tsx, not guessed). Renders
 * nothing when there's only one location (nothing to switch between —
 * a disabled-feeling single-option dropdown isn't useful), just a label
 * instead.
 */

import { useLocation } from '@/context/LocationContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

export function LocationSwitcher({ className }: { className?: string }) {
  const { locations, selectedLocationId, setSelectedLocationId, isLoading } = useLocation();

  if (isLoading) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>
        Loading locations…
      </span>
    );
  }

  if (locations.length === 0) return null;

  if (locations.length === 1) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', className)}>
        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {locations[0].name}
      </span>
    );
  }

  return (
    <Select value={selectedLocationId ?? undefined} onValueChange={setSelectedLocationId}>
      <SelectTrigger className={cn('w-[200px]', className)}>
        <MapPin className="h-3.5 w-3.5 mr-1.5 text-muted-foreground shrink-0" />
        <SelectValue placeholder="Select location" />
      </SelectTrigger>
      <SelectContent>
        {locations.map((loc) => (
          <SelectItem key={loc.id} value={loc.id}>
            {loc.name}
            {!loc.isActive && ' (inactive)'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
