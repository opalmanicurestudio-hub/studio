'use client';
// src/components/drive-thru/PlacePick.tsx — WHICH LOCATION A TABLET IS AT, while a manager sets it up (design board "More
// than one location"; lib/here-server). Only with more than one location (api/kitchen 'screens' lists them); it starts on
// the location picked in the app. The screen then shows only that location's orders; a manager can change it later on
// the Screens page.
import { useEffect, useState } from 'react';

const MUTED = '#6d7075', LINE = '#ececee';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';

export function usePlaces(tenantId: string, on: boolean) {
  const [locs, setLocs] = useState<{ id: string; name: string }[]>([]); const [at, setAt] = useState('');
  useEffect(() => {
    if (!on || !tenantId) return; let live = true;
    void fetch('/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action: 'screens' }) })
      .then((r) => r.json()).then((d) => {
        if (!live || !d?.ok || !Array.isArray(d.locations) || d.locations.length < 2) return;
        setLocs(d.locations);
        let picked = ''; try { picked = localStorage.getItem('selectedLocationId') || ''; } catch { /* private window */ }
        setAt(d.locations.some((l: any) => l.id === picked) ? picked : d.locations[0].id);
      }).catch(() => null);
    return () => { live = false; };
  }, [tenantId, on]);
  return { locs, at, setAt };
}

export function PlacePick({ locs, at, setAt }: { locs: { id: string; name: string }[]; at: string; setAt: (v: string) => void }) {
  if (locs.length < 2) return null;
  return (
    <label className="block"><span className="text-[14px] font-medium">Where is this tablet?</span>
      <select value={at} onChange={(e) => setAt(e.target.value)} aria-describedby="place-pick-help" className={`mt-1.5 min-h-[44px] w-full rounded-xl bg-[#fff] px-3 text-[16px] ${RING}`} style={{ border: `1px solid ${LINE}` }}>
        {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <span id="place-pick-help" className="mt-1 block text-[13px]" style={{ color: MUTED }}>It shows only this location’s orders. You can change it on the Screens page.</span>
    </label>);
}
